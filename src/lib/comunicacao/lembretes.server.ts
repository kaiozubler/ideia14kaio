import { enviarParaPaciente } from "./envio.server";

/**
 * Avisos automáticos de consulta pelo WhatsApp da clínica:
 *  - confirmação: logo após o agendamento ser criado (agendamentos das
 *    últimas 24h, ainda no futuro);
 *  - lembrete: X horas antes da consulta (automacoes.lembrete_horas_antes).
 *
 * Roda a cada execução de /api/public/hooks/comunicacao-lembretes (agendar
 * a cada 15 min). Cada (agendamento, tipo) é "reservado" em
 * comunicacao_whatsapp_envios_automaticos ANTES de enviar — a chave única
 * garante um único aviso mesmo com execuções sobrepostas.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

const STATUS_IGNORADOS = [
  "cancelado",
  "cancelada",
  "finalizado",
  "concluido",
  "concluído",
  "faltou",
  "realizado",
];
const MAX_POR_EXECUCAO = 200;

function dentroDoHorario(inicio: string, fim: string, agora = new Date()) {
  const hm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(agora)
    .slice(0, 5);
  return hm >= String(inicio).slice(0, 5) && hm <= String(fim).slice(0, 5);
}

async function jaEnviados(db: Db, ids: string[], tipo: string) {
  if (!ids.length) return new Set<string>();
  const { data } = await db
    .from("comunicacao_whatsapp_envios_automaticos")
    .select("agendamento_id")
    .eq("tipo", tipo)
    .in("agendamento_id", ids);
  return new Set<string>((data || []).map((r: any) => r.agendamento_id));
}

async function enviarAviso(
  db: Db,
  idMedico: string,
  ag: any,
  tipo: "lembrete_consulta" | "confirmacao_agendamento",
  modeloId: string,
) {
  const { error: reservaErr } = await db
    .from("comunicacao_whatsapp_envios_automaticos")
    .insert({ id_medico: idMedico, agendamento_id: ag.id, tipo });
  if (reservaErr) return "duplicado"; // outra execução já reservou
  try {
    const r = await enviarParaPaciente(db, {
      idMedico,
      destino: { pacienteId: ag.paciente_id, telefone: ag.paciente_id ? null : ag.telefone },
      tipo: "modelo",
      modeloId,
      agendamentoId: ag.id,
    });
    await db
      .from("comunicacao_whatsapp_envios_automaticos")
      .update({ mensagem_id: r.mensagem?.id ?? null })
      .eq("agendamento_id", ag.id)
      .eq("tipo", tipo);
    return "enviado";
  } catch (e) {
    await db
      .from("comunicacao_whatsapp_envios_automaticos")
      .update({ sucesso: false, erro: e instanceof Error ? e.message : String(e) })
      .eq("agendamento_id", ag.id)
      .eq("tipo", tipo);
    return "falhou";
  }
}

export async function processarAvisosAutomaticos(db: Db) {
  const resumo = { clinicas: 0, enviados: 0, falhas: 0, fora_do_horario: 0 };
  const { data: automacoes } = await db
    .from("comunicacao_whatsapp_automacoes")
    .select("*")
    .or("lembrete_ativo.eq.true,confirmacao_ativo.eq.true");
  let orcamento = MAX_POR_EXECUCAO;

  for (const a of automacoes || []) {
    if (orcamento <= 0) break;
    const { data: con } = await db
      .from("comunicacao_whatsapp_conexoes")
      .select("status")
      .eq("id_medico", a.id_medico)
      .maybeSingle();
    if (con?.status !== "conectado") continue;
    resumo.clinicas++;
    if (!dentroDoHorario(a.horario_inicio, a.horario_fim)) {
      resumo.fora_do_horario++;
      continue;
    }
    const agora = new Date();
    const filtroStatus = `(${STATUS_IGNORADOS.map((s) => `"${s}"`).join(",")})`;

    const tarefas: {
      tipo: "lembrete_consulta" | "confirmacao_agendamento";
      modelo: string;
      ags: any[];
    }[] = [];
    if (a.confirmacao_ativo && a.confirmacao_modelo_id) {
      const { data } = await db
        .from("agendamentos")
        .select("id,paciente_id,telefone,data_hora,status")
        .eq("id_medico", a.id_medico)
        .gte("created_at", new Date(agora.getTime() - 24 * 3600 * 1000).toISOString())
        .gt("data_hora", agora.toISOString())
        .not("status", "in", filtroStatus)
        .limit(orcamento);
      tarefas.push({
        tipo: "confirmacao_agendamento",
        modelo: a.confirmacao_modelo_id,
        ags: data || [],
      });
    }
    if (a.lembrete_ativo && a.lembrete_modelo_id) {
      const { data } = await db
        .from("agendamentos")
        .select("id,paciente_id,telefone,data_hora,status,created_at")
        .eq("id_medico", a.id_medico)
        .gt("data_hora", agora.toISOString())
        .lte(
          "data_hora",
          new Date(agora.getTime() + a.lembrete_horas_antes * 3600 * 1000).toISOString(),
        )
        .not("status", "in", filtroStatus)
        .limit(orcamento);
      // Agendado já dentro da janela do lembrete (ex.: marcou para amanhã):
      // a confirmação, se ativa, já cumpre o papel — evita duas mensagens seguidas.
      const ags = (data || []).filter(
        (ag: any) =>
          !(a.confirmacao_ativo && a.confirmacao_modelo_id) ||
          new Date(ag.data_hora).getTime() - new Date(ag.created_at).getTime() >
            a.lembrete_horas_antes * 3600 * 1000,
      );
      tarefas.push({ tipo: "lembrete_consulta", modelo: a.lembrete_modelo_id, ags });
    }

    for (const t of tarefas) {
      const enviados = await jaEnviados(
        db,
        t.ags.map((x) => x.id),
        t.tipo,
      );
      for (const ag of t.ags) {
        if (orcamento <= 0) break;
        if (enviados.has(ag.id) || (!ag.paciente_id && !ag.telefone)) continue;
        const r = await enviarAviso(db, a.id_medico, ag, t.tipo, t.modelo);
        if (r === "enviado") {
          resumo.enviados++;
          orcamento--;
        } else if (r === "falhou") resumo.falhas++;
      }
    }
  }
  return resumo;
}
