// Cupom na contratação pública (/planos → /contratacao/*): confere o cupom
// contra a contratação gravada, acerta o valor de cada cobrança do Asaas e
// põe o recurso extra na assinatura. As regras ficam em ./regras.ts.

import { asaasFetch } from "@/lib/asaas/client.server";
import { PLANOS_BASE, precoMensalNoServidor } from "@/lib/plans/config";
import {
  aplicarCupom,
  bonusVigente,
  normalizarCodigo,
  primeiraCobrancaEm,
  semCobranca,
  textoDoCupom,
  valorDaCobrancaComCupom,
  type Cupom,
  type CupomAplicado,
} from "./regras.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type ContratacaoParaCupom = {
  id: string;
  plano: string;
  medicos: number;
  secretarias: number;
  copiloto: number;
  whatsapp: number;
  video: number;
  copiloto_ativo: boolean | null;
  ciclo: string;
  cupom_id?: string | null;
};

export const COLUNAS_CONTRATACAO_CUPOM =
  "id, plano, medicos, secretarias, copiloto, whatsapp, video, copiloto_ativo, ciclo, cupom_id, status, asaas_checkout_id";

const COLUNAS =
  "id, codigo, tipo, valor, recurso, planos, ciclo, duracao_meses, valido_de, valido_ate, limite_usos, ativo";

export type AvaliacaoCupom =
  | { ok: false; status: number; motivo: string }
  | { ok: true; cupomId: string; cupom: CupomAplicado; precoMensal: number };

/**
 * Confere o cupom (pelo código digitado ou, sem código, o já gravado na
 * contratação) contra o plano, o ciclo e o preço calculados no servidor.
 */
export async function avaliarCupom(
  db: Db,
  c: ContratacaoParaCupom,
  codigo?: string,
): Promise<AvaliacaoCupom> {
  let q = db.from("cupons").select(COLUNAS);
  q = codigo ? q.eq("codigo", normalizarCodigo(codigo)) : q.eq("id", c.cupom_id);
  const { data: cupom, error } = await q.maybeSingle();
  if (error) throw new Error(`cupons: ${error.message}`);
  if (!cupom)
    return { ok: false, status: 404, motivo: "Cupom não encontrado. Confira o nome digitado." };

  const plano = PLANOS_BASE.find((p) => p.id === c.plano);
  if (!plano) return { ok: false, status: 400, motivo: "plano inválido" };
  const precoMensal = precoMensalNoServidor(plano, {
    medicos: c.medicos,
    secretarias: c.secretarias,
    copiloto: c.copiloto,
    whatsapp: c.whatsapp,
    video: c.video,
    copilotoAtivo: !!c.copiloto_ativo,
  });
  if (precoMensal === null) {
    return {
      ok: false,
      status: 409,
      motivo: "Plano com item sob consulta: o cupom é aplicado pelo nosso time na proposta.",
    };
  }

  // Usos das outras contratações (esta não conta contra o próprio limite).
  const { count, error: errUsos } = await db
    .from("contratacoes")
    .select("id", { count: "exact", head: true })
    .eq("cupom_id", cupom.id)
    .neq("status", "cancelada")
    .neq("id", c.id);
  if (errUsos) throw new Error(`contratacoes: ${errUsos.message}`);

  const r = aplicarCupom(
    { ...(cupom as Cupom), valor: Number(cupom.valor) },
    { plano: c.plano, ciclo: c.ciclo === "anual" ? "anual" : "mensal", precoMensal },
    { usos: count ?? 0 },
  );
  if (!r.ok) return { ok: false, status: 400, motivo: r.motivo };
  return { ok: true, cupomId: cupom.id, cupom: { ...r, codigo: cupom.codigo }, precoMensal };
}

/** O que o navegador mostra do cupom aplicado. */
export function resumoParaCliente(
  cupom: CupomAplicado,
  precoMensal: number,
  ciclo: "mensal" | "anual",
) {
  const hoje = new Date().toISOString().slice(0, 10);
  return {
    codigo: cupom.codigo,
    texto: textoDoCupom(cupom),
    descontoMensal: cupom.descontoMensal,
    precoMensalComDesconto: cupom.precoMensalComDesconto,
    meses: cupom.meses,
    diasTeste: cupom.diasTeste,
    bonificado: cupom.bonificado,
    semCobranca: semCobranca(cupom),
    primeiraCobrancaEm: primeiraCobrancaEm(cupom, hoje),
    valorPrimeiraCobranca: valorDaCobrancaComCupom(cupom, precoMensal, ciclo, 0),
  };
}

// ---------------------------------------------------------------------------
// Depois da contratação: cobranças seguintes e recurso extra
// ---------------------------------------------------------------------------

const COLUNA_BONUS = {
  copiloto: "copiloto",
  whatsapp: "whatsapp",
  video: "video",
  medicos: "medicos",
  secretarias: "secretarias",
} as const;

/** Franquias da assinatura com o recurso extra do cupom somado (na ativação). */
export function comBonus<T extends Record<string, unknown>>(
  assinatura: T,
  cupom: CupomAplicado | null,
  ciclo: "mensal" | "anual",
): T {
  if (!cupom?.bonus || !bonusVigente(cupom, ciclo, 0)) return assinatura;
  if (cupom.bonus.recurso === "copiloto_ativo") return { ...assinatura, copiloto_ativo: true };
  const col = COLUNA_BONUS[cupom.bonus.recurso];
  return { ...assinatura, [col]: Number(assinatura[col] ?? 0) + cupom.bonus.quantidade };
}

/**
 * Chamado pelo webhook em PAYMENT_CREATED de uma assinatura: acerta no Asaas o
 * valor desta cobrança conforme o cupom (o desconto por N meses acaba aqui) e
 * tira o recurso extra quando o prazo dele termina. Falha só registra no log.
 */
export async function ajustarCobrancaComCupom(
  db: Db,
  subscriptionId: string,
  payment: { id?: string; value?: number },
) {
  const { data: assinatura } = await db
    .from("assinaturas")
    .select("id, contratacao_id, ciclo, plano, copiloto, whatsapp, video, medicos, secretarias")
    .eq("asaas_subscription_id", subscriptionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!assinatura?.contratacao_id) return;
  const { data: c } = await db
    .from("contratacoes")
    .select("id, cupom_aplicado, preco_mensal_calculado")
    .eq("id", assinatura.contratacao_id)
    .maybeSingle();
  const cupom = c?.cupom_aplicado as (CupomAplicado & { bonus_removido_em?: string }) | null;
  if (!cupom || c.preco_mensal_calculado == null) return;

  // k = quantas cobranças desta assinatura vieram antes desta.
  const { count } = await db
    .from("asaas_cobrancas")
    .select("asaas_payment_id", { count: "exact", head: true })
    .eq("asaas_subscription_id", subscriptionId)
    .neq("asaas_payment_id", payment.id ?? "");
  const k = count ?? 0;
  const ciclo = assinatura.ciclo === "anual" ? "anual" : "mensal";

  const esperado = valorDaCobrancaComCupom(cupom, Number(c.preco_mensal_calculado), ciclo, k);
  if (payment.value != null && Math.abs(payment.value - esperado) > 0.009) {
    try {
      await asaasFetch(`/subscriptions/${subscriptionId}`, {
        method: "PUT",
        body: JSON.stringify({ value: esperado, updatePendingPayments: true }),
      });
    } catch (err) {
      console.error("[cupom] não foi possível acertar o valor da cobrança no Asaas:", err);
    }
  }

  if (cupom.bonus && !cupom.bonus_removido_em && !bonusVigente(cupom, ciclo, k)) {
    const plano = PLANOS_BASE.find((p) => p.id === assinatura.plano);
    let update: Record<string, unknown>;
    if (cupom.bonus.recurso === "copiloto_ativo") update = { copiloto_ativo: false };
    else {
      const col = COLUNA_BONUS[cupom.bonus.recurso];
      const minimo = Number(plano?.[col] ?? 0);
      update = { [col]: Math.max(minimo, Number(assinatura[col]) - cupom.bonus.quantidade) };
    }
    const { error } = await db.from("assinaturas").update(update).eq("id", assinatura.id);
    if (error) return console.error("[cupom] erro ao tirar o recurso extra:", error.message);
    await db
      .from("contratacoes")
      .update({ cupom_aplicado: { ...cupom, bonus_removido_em: new Date().toISOString() } })
      .eq("id", c.id);
  }
}
