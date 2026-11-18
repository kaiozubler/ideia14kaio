// Carrega do banco o que os insights de uso precisam (agregados por dia,
// consumo do mês, adicionais e licenças) e monta a resposta da ponte com as
// regras de src/lib/crm/uso.ts.

import {
  assinaturaDe,
  carregarBase,
  idsDeClinicas,
  montarUsuario,
  nomeClinicaDe,
  type Base,
} from "@/lib/crm/dados.server";
import { ErroCrm } from "@/lib/crm/ponte";
import type { Db } from "@/lib/crm/rota.server";
import {
  calcularUso,
  hojeBrasilia,
  periodos,
  rankingTelas,
  serieDiaria,
  somarDias,
  type Adicional,
  type ClinicaUso,
  type Consumo,
  type DiaAtividade,
  type DiaTela,
  type DiaUsuario,
} from "@/lib/crm/uso";

/** Histórico usado para a média da própria clínica (6 meses). */
const HISTORICO_DIAS = 180;

function falha(tabela: string, error: { message: string } | null) {
  if (error) throw new Error(`${tabela}: ${error.message}`);
}

/** RPC paginado: o PostgREST devolve no máximo 1000 linhas por chamada. */
async function rpcTudo<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.rpc(fn, args).range(de, de + 999);
    falha(fn, error);
    const lote = (data ?? []) as T[];
    todas.push(...lote);
    if (lote.length < 1000) return todas;
  }
}

type FranquiaRow = { id: string; copiloto: number; whatsapp: number; video: number };
type ConsumoRow = {
  assinatura_id: string;
  recurso: string;
  usado_plano: number;
  usado_adicional: number;
};
type CreditoRow = {
  assinatura_id: string;
  recurso: string;
  quantidade: number;
  consumido: number;
  valor_pago: number | null;
  created_at: string;
};

async function montarClinicas(
  db: Db,
  base: Base,
  ids: string[],
  hoje: string,
): Promise<ClinicaUso[]> {
  const assinaturas = new Map(ids.map((id) => [id, assinaturaDe(base, id)]));
  const idsAssinatura = [...assinaturas.values()].filter((a) => !!a).map((a) => a!.id);
  const mes = `${hoje.slice(0, 7)}-01`;

  const [franquias, consumo, creditos, medicos] = await Promise.all([
    idsAssinatura.length
      ? db.from("assinaturas").select("id, copiloto, whatsapp, video").in("id", idsAssinatura)
      : { data: [], error: null },
    idsAssinatura.length
      ? db
          .from("consumo_mensal")
          .select("assinatura_id, recurso, usado_plano, usado_adicional")
          .eq("mes", mes)
          .in("assinatura_id", idsAssinatura)
      : { data: [], error: null },
    idsAssinatura.length
      ? db
          .from("creditos_adicionais")
          .select("assinatura_id, recurso, quantidade, consumido, valor_pago, created_at")
          .eq("status", "pago")
          .in("assinatura_id", idsAssinatura)
      : { data: [], error: null },
    db.from("agenda_medicos").select("clinica_id").eq("ativo", true),
  ]);
  falha("assinaturas", franquias.error);
  falha("consumo_mensal", consumo.error);
  falha("creditos_adicionais", creditos.error);
  falha("agenda_medicos", medicos.error);

  const franquiaPor = new Map(((franquias.data ?? []) as FranquiaRow[]).map((f) => [f.id, f]));
  const medicosPor = new Map<string, number>();
  for (const m of (medicos.data ?? []) as { clinica_id: string }[])
    medicosPor.set(m.clinica_id, (medicosPor.get(m.clinica_id) ?? 0) + 1);
  const equipePor = new Map<string, number>();
  for (const m of base.membros)
    if (m.status === "ativo" || m.status === "convidado")
      equipePor.set(m.clinica_id, (equipePor.get(m.clinica_id) ?? 0) + 1);

  return ids.map((id) => {
    const a = assinaturas.get(id) ?? null;
    const dono = base.usuarios.get(id);
    const consumoLista: Consumo[] = [];
    const adicionais: Adicional[] = [];
    if (a) {
      const f = franquiaPor.get(a.id);
      const meus = ((creditos.data ?? []) as CreditoRow[]).filter((c) => c.assinatura_id === a.id);
      for (const recurso of ["copiloto", "whatsapp", "video"] as const) {
        const linha = ((consumo.data ?? []) as ConsumoRow[]).find(
          (c) => c.assinatura_id === a.id && c.recurso === recurso,
        );
        consumoLista.push({
          recurso,
          franquia: Number(f?.[recurso] ?? 0),
          usado: Number(linha?.usado_plano ?? 0) + Number(linha?.usado_adicional ?? 0),
          saldo_adicional: meus
            .filter((c) => c.recurso === recurso)
            .reduce((s, c) => s + (c.quantidade - c.consumido), 0),
        });
      }
      for (const c of meus)
        adicionais.push({
          recurso: c.recurso,
          quantidade: c.quantidade,
          data: c.created_at.slice(0, 10),
          valor: c.valor_pago == null ? null : Number(c.valor_pago),
        });
    }
    return {
      id,
      nome: nomeClinicaDe(base, id),
      inicio: (dono?.created_at ?? a?.created_at ?? hoje).slice(0, 10),
      ultimo_login: dono?.last_sign_in_at ?? null,
      assinatura: a
        ? {
            plano: a.plano,
            status: a.status,
            preco_mensal: Number(a.preco_mensal),
            cancelamento_agendado_para:
              a.status === "cancelada" ? null : a.cancelamento_agendado_para,
            medicos: a.medicos,
            secretarias: a.secretarias,
          }
        : null,
      licencas_em_uso: { medicos: medicosPor.get(id) ?? 0, secretarias: equipePor.get(id) ?? 0 },
      consumo: consumoLista,
      adicionais,
    };
  });
}

async function carregarDias(db: Db, desde: string) {
  const [usuarios, atividade, telas] = await Promise.all([
    rpcTudo<DiaUsuario>(db, "crm_uso_usuarios_dia", { p_desde: desde }),
    rpcTudo<DiaAtividade>(db, "crm_uso_atividade_dia", { p_desde: desde }),
    rpcTudo<DiaTela>(db, "crm_uso_telas_dia", { p_desde: desde }),
  ]);
  return { usuarios, atividade, telas };
}

/** GET uso: visão da carteira inteira. */
export async function usoDaCarteira(db: Db, dias: number) {
  const hoje = hojeBrasilia();
  const desde = somarDias(hoje, -HISTORICO_DIAS);
  const base = await carregarBase(db);
  const ids = idsDeClinicas(base);
  const [clinicas, d] = await Promise.all([
    montarClinicas(db, base, ids, hoje),
    carregarDias(db, desde),
  ]);
  const r = calcularUso({ hoje, dias, historicoDias: HISTORICO_DIAS, clinicas, ...d });
  const p = periodos(hoje, dias, HISTORICO_DIAS);
  return {
    ...r,
    diario: serieDiaria(d.usuarios, d.atividade, p.anterior?.inicio ?? p.atual.inicio, hoje),
    telas: rankingTelas(d.telas, p.atual, p.anterior),
  };
}

/** GET clinicas/:id/uso: a clínica comparada com a carteira, com logins e telas. */
export async function usoDaClinica(db: Db, id: string, dias: number) {
  const hoje = hojeBrasilia();
  const desde = somarDias(hoje, -HISTORICO_DIAS);
  const base = await carregarBase(db);
  const ids = idsDeClinicas(base);
  if (!ids.includes(id)) throw new ErroCrm(404, "clínica não encontrada");
  const [clinicas, d] = await Promise.all([
    montarClinicas(db, base, ids, hoje),
    carregarDias(db, desde),
  ]);
  const r = calcularUso({ hoje, dias, historicoDias: HISTORICO_DIAS, clinicas, ...d });
  const p = periodos(hoje, dias, HISTORICO_DIAS);
  const daClinica = r.clinicas.find((c) => c.clinica_id === id)!;
  const usuarios = d.usuarios.filter((u) => u.clinica_id === id);
  const atividade = d.atividade.filter((a) => a.clinica_id === id);

  // Logins da clínica: o dono e a equipe, mesmo quem nunca acessou.
  const logins = new Set([
    id,
    ...base.membros.filter((m) => m.clinica_id === id && m.user_id).map((m) => m.user_id as string),
  ]);
  const porLogin = [...logins].map((uid) => {
    const meus = usuarios.filter((u) => u.user_id === uid);
    const atual = meus.filter((u) => u.dia >= p.atual.inicio);
    const anterior = p.anterior
      ? meus.filter((u) => u.dia >= p.anterior!.inicio && u.dia <= p.anterior!.fim)
      : [];
    const auth = base.usuarios.get(uid);
    const perfil = auth ? montarUsuario(base, auth) : null;
    return {
      id: uid,
      nome: perfil?.nome ?? null,
      email: perfil?.email ?? null,
      papel: perfil?.papel ?? "medico",
      ultimo_acesso:
        meus
          .map((u) => u.dia)
          .sort()
          .pop() ?? null,
      ultimo_login: auth?.last_sign_in_at ?? null,
      acessos: atual.reduce((s, u) => s + u.acessos, 0),
      dias_ativos: atual.length,
      dias_ativos_anterior: anterior.length,
      telas: atual.reduce((s, u) => s + u.telas, 0),
    };
  });

  return {
    periodo: r.periodo,
    parceiros: r.parceiros,
    clinica: daClinica,
    diario: serieDiaria(usuarios, atividade, p.anterior?.inicio ?? p.atual.inicio, hoje),
    telas: rankingTelas(
      d.telas.filter((t) => t.clinica_id === id),
      p.atual,
      p.anterior,
    ),
    usuarios: porLogin.sort((a, b) =>
      String(b.ultimo_acesso ?? "").localeCompare(String(a.ultimo_acesso ?? "")),
    ),
  };
}
