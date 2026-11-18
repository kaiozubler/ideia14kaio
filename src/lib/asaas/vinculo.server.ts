// Liga as cobranças do Asaas à clínica e mantém a próxima cobrança da
// assinatura em dia. Usado pelo webhook, pela ativação manual de contratação
// e pela sincronização do Zubler CRM.

import { asaasFetch } from "@/lib/asaas/client.server";
import type { PaymentAsaas } from "@/lib/asaas/cobrancas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type Vinculo = { medicoId: string | null; assinaturaId: string | null };

/**
 * Clínica de uma cobrança: pela assinatura do Asaas; sem ela (compra avulsa de
 * créditos, cobrança antes da ativação), pelo cliente do Asaas na assinatura
 * ou na contratação.
 */
export async function vinculoDaCobranca(db: Db, payment: PaymentAsaas): Promise<Vinculo> {
  if (payment.subscription) {
    const { data } = await db
      .from("assinaturas")
      .select("id, medico_id")
      .eq("asaas_subscription_id", payment.subscription)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { medicoId: data.medico_id, assinaturaId: data.id };
  }
  if (payment.customer) {
    const { data } = await db
      .from("assinaturas")
      .select("id, medico_id")
      .eq("asaas_customer_id", payment.customer)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { medicoId: data.medico_id, assinaturaId: data.id };
    const { data: c } = await db
      .from("contratacoes")
      .select("user_id")
      .eq("asaas_customer_id", payment.customer)
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (c?.user_id) return { medicoId: c.user_id, assinaturaId: null };
  }
  return { medicoId: null, assinaturaId: null };
}

/** Cobranças já registradas sem clínica passam para a assinatura (pela assinatura ou pelo cliente do Asaas). */
export async function vincularCobrancasSemClinica(
  db: Db,
  a: {
    id: string;
    medico_id: string;
    asaas_subscription_id: string | null;
    asaas_customer_id: string | null;
  },
): Promise<void> {
  const filtros = [
    a.asaas_subscription_id ? `asaas_subscription_id.eq.${a.asaas_subscription_id}` : null,
    a.asaas_customer_id ? `asaas_customer_id.eq.${a.asaas_customer_id}` : null,
  ].filter(Boolean);
  if (!filtros.length) return;
  const { error } = await db
    .from("asaas_cobrancas")
    .update({ medico_id: a.medico_id, assinatura_id: a.id })
    .is("medico_id", null)
    .or(filtros.join(","));
  if (error) console.error("[asaas] erro ao vincular cobranças sem clínica:", error.message);
}

/**
 * Próxima cobrança = nextDueDate da assinatura no Asaas. Não mexe em
 * assinatura cancelada nem com cancelamento agendado (a data ali é o fim do acesso).
 */
export async function atualizarProximaCobranca(db: Db, subscriptionId: string): Promise<void> {
  try {
    const sub = await asaasFetch<{ nextDueDate?: string; deleted?: boolean; status?: string }>(
      `/subscriptions/${subscriptionId}`,
    );
    if (sub.deleted || sub.status !== "ACTIVE" || !sub.nextDueDate) return;
    const { error } = await db
      .from("assinaturas")
      .update({ proxima_cobranca: sub.nextDueDate })
      .eq("asaas_subscription_id", subscriptionId)
      .neq("status", "cancelada")
      .is("cancelamento_agendado_para", null);
    if (error) console.error("[asaas] erro ao salvar próxima cobrança:", error.message);
  } catch (err) {
    console.error(
      "[asaas] não foi possível ler a assinatura:",
      err instanceof Error ? err.message : err,
    );
  }
}
