// Leituras do link público de agendamento. Usa supabaseAdmin porque o paciente
// não tem sessão; por isso devolve só o que a página pode mostrar, nunca dados
// de consultas ou de outros pacientes.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  calcularHorariosLivres,
  especialidadePublica,
  statusLiberaHorario,
  type DiaLivre,
  type GradeSemanal,
  type Ocupado,
} from "./disponibilidade";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

type Config = {
  clinica_id: string;
  horarios: GradeSemanal;
  antecedencia_horas: number;
  janela_dias: number;
};

type Medico = {
  id: string;
  nome: string;
  especialidade: string | null;
  rqe: string | null;
  duracao_min: number;
  horarios: GradeSemanal | null;
};

/** Config do link, ou null se ele não existe, está desligado ou a clínica perdeu o acesso. */
export async function configDoLink(token: string): Promise<Config | null> {
  const { data: cfg, error } = await db
    .from("agenda_online_config")
    .select("clinica_id,horarios,antecedencia_horas,janela_dias")
    .eq("token", token)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw error;
  if (!cfg) return null;

  const [{ data: bloqueio, error: bloqueioErr }, { data: assinatura, error: assinaturaErr }] =
    await Promise.all([
      db.from("acessos_bloqueados").select("user_id").eq("user_id", cfg.clinica_id).maybeSingle(),
      db
        .from("assinaturas")
        .select("id")
        .eq("medico_id", cfg.clinica_id)
        .neq("status", "cancelada")
        .limit(1)
        .maybeSingle(),
    ]);
  if (bloqueioErr) throw bloqueioErr;
  if (assinaturaErr) throw assinaturaErr;
  return !bloqueio && assinatura ? (cfg as Config) : null;
}

async function medicosAtivos(clinicaId: string): Promise<Medico[]> {
  const { data, error } = await db
    .from("agenda_medicos")
    .select("id,nome,especialidade,rqe,duracao_min,horarios")
    .eq("clinica_id", clinicaId)
    .eq("ativo", true)
    .order("responsavel", { ascending: false })
    .order("nome");
  if (error) throw error;
  return data ?? [];
}

export async function dadosDaClinica(cfg: Config) {
  const [{ data: clinica, error }, medicos] = await Promise.all([
    db
      .from("medico_clinica_config")
      .select("fantasia,logradouro,numero,bairro,cidade,uf,telefone,cor_primaria,logo_data_url")
      .eq("id_medico", cfg.clinica_id)
      .maybeSingle(),
    medicosAtivos(cfg.clinica_id),
  ]);
  if (error) throw error;
  return {
    clinica: {
      nome: clinica?.fantasia || "Clínica",
      endereco:
        [
          [clinica?.logradouro, clinica?.numero].filter(Boolean).join(", "),
          clinica?.bairro,
          [clinica?.cidade, clinica?.uf].filter(Boolean).join(" - "),
        ]
          .filter(Boolean)
          .join(" · ") || null,
      telefone: clinica?.telefone || null,
      cor: clinica?.cor_primaria || null,
      logo: clinica?.logo_data_url || null,
    },
    medicos: medicos.map((m) => ({
      id: m.id,
      nome: m.nome,
      especialidade: especialidadePublica(m.especialidade, m.rqe),
      duracao_min: m.duracao_min,
    })),
  };
}

/** Horários livres do médico; null se ele não pertence a esta clínica. */
export async function horariosDoMedico(cfg: Config, medicoId: string): Promise<DiaLivre[] | null> {
  const medico = (await medicosAtivos(cfg.clinica_id)).find((m) => m.id === medicoId);
  if (!medico) return null;

  const agoraMs = Date.now();
  // Recua um dia para pegar consulta que começou antes e ainda ocupa o horário.
  const desde = new Date(agoraMs - 24 * 60 * 60 * 1000).toISOString();
  const ate = new Date(agoraMs + (cfg.janela_dias + 2) * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("agendamentos")
    .select("data_hora,duracao_min,status")
    .eq("id_medico", cfg.clinica_id)
    .or(`agenda_medico_id.eq.${medico.id},agenda_medico_id.is.null`)
    .gte("data_hora", desde)
    .lte("data_hora", ate);
  if (error) throw error;

  const ocupados: Ocupado[] = (data ?? [])
    .filter((a: { status: string | null }) => !statusLiberaHorario(a.status))
    .map((a: { data_hora: string; duracao_min: number }) => ({
      inicio: a.data_hora,
      duracaoMin: a.duracao_min,
    }));

  return calcularHorariosLivres({
    clinica: cfg.horarios,
    medico: medico.horarios,
    duracaoMin: medico.duracao_min,
    ocupados,
    agoraMs,
    antecedenciaHoras: cfg.antecedencia_horas,
    janelaDias: cfg.janela_dias,
  });
}
