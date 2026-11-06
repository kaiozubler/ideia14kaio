// Leitura e escrita dos cupons no Supabase (service role), usada pela ponte
// do CRM. As regras ficam em ./regras.ts.

import { ErroCrm } from "@/lib/crm/ponte";
import type { Db } from "@/lib/crm/rota.server";
import {
  DESCONTO_ANUAL,
  MAX_MEDICOS,
  MAX_SECRETARIAS,
  PLANOS_BASE,
  PRECO_COPILOTO_ATIVO_POR_CONSULTA,
  PRECO_MEDICO_ADICIONAL,
  PRECO_SECRETARIA_ADICIONAL,
  TIERS_COPILOTO,
  TIERS_VIDEO,
  TIERS_WHATSAPP,
} from "@/lib/plans/config";

export const COLUNAS_CUPOM =
  "id, codigo, descricao, tipo, valor, recurso, planos, ciclo, duracao_meses, valido_de, valido_ate, limite_usos, ativo, criado_por, created_at, updated_at";

type CupomRow = Record<string, unknown> & { id: string; valor: number | string };

/** Postgres devolve numeric como texto. */
export function linhaCupom(c: CupomRow, usos: number) {
  return { ...c, valor: Number(c.valor), usos };
}

/** Quantas contratações (não canceladas) usaram cada cupom. */
export async function usosPorCupom(db: Db, ids?: string[]): Promise<Map<string, number>> {
  let q = db
    .from("contratacoes")
    .select("cupom_id")
    .not("cupom_id", "is", null)
    .neq("status", "cancelada");
  if (ids) q = q.in("cupom_id", ids);
  const { data, error } = await q;
  if (error) throw new Error(`contratacoes: ${error.message}`);
  const usos = new Map<string, number>();
  for (const r of (data ?? []) as { cupom_id: string }[])
    usos.set(r.cupom_id, (usos.get(r.cupom_id) ?? 0) + 1);
  return usos;
}

export async function buscarCupom(db: Db, id: string) {
  const { data, error } = await db.from("cupons").select(COLUNAS_CUPOM).eq("id", id).maybeSingle();
  if (error) throw new Error(`cupons: ${error.message}`);
  if (!data) throw new ErroCrm(404, "cupom não encontrado");
  return data as CupomRow;
}

/** Violação do índice único do código vira 409 com o nome do cupom. */
export function erroDeGravacao(error: { code?: string; message: string }, codigo: string): never {
  if (error.code === "23505") throw new ErroCrm(409, `Já existe um cupom com o nome ${codigo}.`);
  throw new Error(`cupons: ${error.message}`);
}

/** Planos e preços do app, para o CRM montar a tela sem copiar números. */
export function catalogoPlanos() {
  return {
    planos: PLANOS_BASE,
    tiers: { copiloto: TIERS_COPILOTO, whatsapp: TIERS_WHATSAPP, video: TIERS_VIDEO },
    adicionais: {
      medico: PRECO_MEDICO_ADICIONAL,
      secretaria: PRECO_SECRETARIA_ADICIONAL,
      copiloto_ativo_por_consulta: PRECO_COPILOTO_ATIVO_POR_CONSULTA,
      max_medicos: MAX_MEDICOS,
      max_secretarias: MAX_SECRETARIAS,
    },
    desconto_anual: DESCONTO_ANUAL,
  };
}
