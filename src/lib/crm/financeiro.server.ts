// Ações financeiras da ponte do Zubler CRM (contrato v2): estorno,
// cancelamento e reativação de assinatura e sincronização com o Asaas. As
// regras sem banco (quanto estornar, como cancelar) ficam em ponte.ts.

import { AsaasApiError, AsaasNaoConfiguradoError, asaasFetch } from "@/lib/asaas/client.server";
import { linhaDaCobranca, type PaymentAsaas } from "@/lib/asaas/cobrancas";
import {
  COLUNAS_ASSINATURA,
  type AssinaturaRow,
  reativarSeInadimplente,
} from "@/lib/crm/dados.server";
import { ErroCrm, planoDeCancelamento, statusDaCobranca, valorDoEstorno } from "@/lib/crm/ponte";
import type { Db } from "@/lib/crm/rota.server";

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function falha(tabela: string, error: { message: string } | null) {
  if (error) throw new Error(`${tabela}: ${error.message}`);
}

/** Erro do Asaas vira mensagem para a equipe (o CRM mostra o texto). */
function erroDoAsaas(err: unknown): never {
  if (err instanceof AsaasNaoConfiguradoError)
    throw new ErroCrm(501, "Asaas não configurado no servidor do app (ASAAS_API_KEY)");
  if (err instanceof AsaasApiError) throw new ErroCrm(502, `Asaas: ${err.message}`);
  throw err;
}

async function noAsaas<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await asaasFetch<T>(path, init);
  } catch (err) {
    erroDoAsaas(err);
  }
}

// ---------------------------------------------------------------------------
// Estorno
// ---------------------------------------------------------------------------

export async function estornarPagamento(
  db: Db,
  id: string,
  pedido: { valor?: number; motivo?: string | null },
  ator: string,
) {
  const motivo = pedido.motivo ?? null;
  const agora = new Date().toISOString();

  if (!id.startsWith("pay_")) {
    // Manual: o dinheiro volta fora do sistema; só registra.
    const { data: p, error } = await db
      .from("pagamentos_manuais")
      .select("id, medico_id, valor, valor_estornado, status")
      .eq("id", id)
      .maybeSingle();
    falha("pagamentos_manuais", error);
    if (!p) throw new ErroCrm(404, "pagamento não encontrado");
    const valor = Number(p.valor);
    const jaEstornado = p.status === "estornado" ? valor : Number(p.valor_estornado ?? 0);
    const plano = valorDoEstorno({ valor, estornado: jaEstornado, status: p.status }, pedido.valor);
    const { data: estorno, error: e1 } = await db
      .from("pagamentos_estornos")
      .insert({
        origem: "manual",
        pagamento_id: id,
        medico_id: p.medico_id,
        valor: plano.valor,
        motivo,
        status: "concluido",
        autor: ator,
        concluido_em: agora,
      })
      .select("id")
      .single();
    falha("pagamentos_estornos", e1);
    const { error: e2 } = await db
      .from("pagamentos_manuais")
      .update({
        status: plano.total ? "estornado" : "estorno_parcial",
        valor_estornado: Math.round((jaEstornado + plano.valor) * 100) / 100,
        estorno_motivo: motivo,
      })
      .eq("id", id);
    falha("pagamentos_manuais", e2);
    return { ok: true, estorno_id: estorno.id, status: "concluido", valor: plano.valor };
  }

  // Asaas: pede o estorno e registra como solicitado; o webhook conclui.
  const { data: c, error } = await db
    .from("asaas_cobrancas")
    .select("asaas_payment_id, medico_id, valor, valor_estornado, status")
    .eq("asaas_payment_id", id)
    .maybeSingle();
  falha("asaas_cobrancas", error);
  if (!c) throw new ErroCrm(404, "cobrança do Asaas não encontrada");
  const valor = Number(c.valor ?? 0);
  const jaEstornado = Number(c.valor_estornado ?? 0);
  const plano = valorDoEstorno(
    { valor, estornado: jaEstornado, status: statusDaCobranca(c.status, valor, jaEstornado) },
    pedido.valor,
  );

  const { data: estorno, error: e1 } = await db
    .from("pagamentos_estornos")
    .insert({
      origem: "asaas",
      pagamento_id: id,
      medico_id: c.medico_id,
      valor: plano.valor,
      motivo,
      status: "solicitado",
      autor: ator,
    })
    .select("id")
    .single();
  falha("pagamentos_estornos", e1);

  let resposta: PaymentAsaas;
  try {
    resposta = await asaasFetch<PaymentAsaas>(`/payments/${id}/refund`, {
      method: "POST",
      body: JSON.stringify({
        value: plano.valor,
        ...(motivo ? { description: motivo.slice(0, 500) } : {}),
      }),
    });
  } catch (err) {
    await db
      .from("pagamentos_estornos")
      .update({ status: "falhou", erro: err instanceof Error ? err.message : String(err) })
      .eq("id", estorno.id);
    erroDoAsaas(err);
  }

  const concluido = resposta.status === "REFUNDED";
  if (concluido) {
    await db
      .from("pagamentos_estornos")
      .update({ status: "concluido", concluido_em: agora })
      .eq("id", estorno.id);
  }
  const { error: e2 } = await db
    .from("asaas_cobrancas")
    .update({
      valor_estornado: Math.round((jaEstornado + plano.valor) * 100) / 100,
      ...(resposta.status ? { status: resposta.status } : {}),
      atualizado_em: agora,
    })
    .eq("asaas_payment_id", id);
  falha("asaas_cobrancas", e2);
  return {
    ok: true,
    estorno_id: estorno.id,
    status: concluido ? "concluido" : "solicitado",
    valor: plano.valor,
  };
}

/**
 * Webhook PAYMENT_REFUNDED / PAYMENT_PARTIALLY_REFUNDED: conclui os estornos
 * pedidos. Estorno total feito por fora (painel do Asaas) vira um registro
 * novo com o que faltava, para o histórico do CRM bater.
 */
export async function concluirEstornosDoAsaas(db: Db, payment: PaymentAsaas, evento: string) {
  if (!payment.id) return;
  const agora = new Date().toISOString();
  const { error } = await db
    .from("pagamentos_estornos")
    .update({ status: "concluido", concluido_em: agora })
    .eq("pagamento_id", payment.id)
    .eq("status", "solicitado");
  if (error) console.error("[asaas:webhook] erro ao concluir estornos:", error.message);
  if (evento !== "PAYMENT_REFUNDED") return;

  const { data: c } = await db
    .from("asaas_cobrancas")
    .select("medico_id, valor, valor_estornado")
    .eq("asaas_payment_id", payment.id)
    .maybeSingle();
  const valor = Number(c?.valor ?? payment.value ?? 0);
  const faltava = Math.round((valor - Number(c?.valor_estornado ?? 0)) * 100) / 100;
  if (faltava <= 0) return;
  await db.from("pagamentos_estornos").insert({
    origem: "asaas",
    pagamento_id: payment.id,
    medico_id: c?.medico_id ?? null,
    valor: faltava,
    motivo: "Estornado direto no Asaas",
    status: "concluido",
    autor: "asaas",
    concluido_em: agora,
  });
  await db
    .from("asaas_cobrancas")
    .update({ valor_estornado: valor })
    .eq("asaas_payment_id", payment.id);
}

// ---------------------------------------------------------------------------
// Assinatura
// ---------------------------------------------------------------------------

async function buscarAssinatura(db: Db, id: string): Promise<AssinaturaRow> {
  const { data, error } = await db
    .from("assinaturas")
    .select(`${COLUNAS_ASSINATURA}, updated_at, created_at`)
    .eq("id", id)
    .maybeSingle();
  falha("assinaturas", error);
  if (!data) throw new ErroCrm(404, "assinatura não encontrada");
  return data as AssinaturaRow;
}

type ListaAsaas<T> = { data?: T[]; hasMore?: boolean };

async function cobrancasDoAsaas(filtro: string, max = 500): Promise<PaymentAsaas[]> {
  const todas: PaymentAsaas[] = [];
  for (let offset = 0; offset < max; offset += 100) {
    const r = await noAsaas<ListaAsaas<PaymentAsaas>>(
      `/payments?${filtro}&limit=100&offset=${offset}`,
    );
    todas.push(...(r.data ?? []));
    if (!r.hasMore) break;
  }
  return todas;
}

/** Apaga no Asaas as cobranças em aberto da assinatura (vencimento >= `aPartirDe`, se dado). */
async function apagarCobrancasEmAberto(
  db: Db,
  subscriptionId: string,
  aPartirDe: string | null,
): Promise<string[]> {
  const abertas = [
    ...(await cobrancasDoAsaas(
      `subscription=${encodeURIComponent(subscriptionId)}&status=PENDING`,
    )),
    ...(aPartirDe
      ? []
      : await cobrancasDoAsaas(
          `subscription=${encodeURIComponent(subscriptionId)}&status=OVERDUE`,
        )),
  ].filter((p) => p.id && (!aPartirDe || (p.dueDate ?? "") >= aPartirDe));
  const apagadas: string[] = [];
  for (const p of abertas) {
    await noAsaas(`/payments/${p.id}`, { method: "DELETE" });
    apagadas.push(p.id as string);
  }
  if (apagadas.length) {
    await db
      .from("asaas_cobrancas")
      .update({ status: "DELETED", atualizado_em: new Date().toISOString() })
      .in("asaas_payment_id", apagadas);
  }
  return apagadas;
}

export async function cancelarAssinatura(
  db: Db,
  id: string,
  pedido: {
    quando: "fim_do_ciclo" | "agora";
    motivo?: string | null;
    observacao?: string | null;
    cancelar_pendentes: boolean;
  },
  ator: string,
) {
  const a = await buscarAssinatura(db, id);
  const plano = planoDeCancelamento(a, pedido.quando, hoje());
  const motivo = [pedido.motivo, pedido.observacao].filter(Boolean).join(" — ") || null;
  // O cancelamento da tela Meu plano já apagou a assinatura no Asaas.
  const jaRemovidaNoAsaas = !!a.cancelamento_agendado_para && !a.cancelamento_reversivel;
  const sub = jaRemovidaNoAsaas ? null : a.asaas_subscription_id;
  const agora = new Date().toISOString();
  let cobrancasApagadas: string[] = [];

  if (plano.imediato) {
    if (sub) {
      // Apaga as cobranças antes da assinatura: depois dela, a busca por
      // subscription pode não trazer mais nada.
      if (pedido.cancelar_pendentes)
        cobrancasApagadas = await apagarCobrancasEmAberto(db, sub, null);
      await noAsaas(`/subscriptions/${sub}`, { method: "DELETE" });
    }
    const { error } = await db
      .from("assinaturas")
      .update({
        status: "cancelada",
        cancelada_em: agora,
        cancelamento_agendado_para: hoje(),
        cancelamento_solicitado_em: a.cancelamento_solicitado_em ?? agora,
        cancelamento_motivo: motivo ?? a.cancelamento_motivo,
        cancelado_por: ator,
        cancelamento_reversivel: false,
        plano_agendado: null,
        plano_agendado_para: null,
      })
      .eq("id", id);
    falha("assinaturas", error);
  } else {
    if (sub) {
      await noAsaas(`/subscriptions/${sub}`, {
        method: "PUT",
        body: JSON.stringify({ endDate: plano.endDate }),
      });
      // Cobrança do próximo ciclo que o Asaas já tenha gerado.
      cobrancasApagadas = await apagarCobrancasEmAberto(db, sub, plano.agendadoPara);
    }
    const { error } = await db
      .from("assinaturas")
      .update({
        cancelamento_agendado_para: plano.agendadoPara,
        cancelamento_solicitado_em: agora,
        cancelamento_motivo: motivo,
        cancelado_por: ator,
        cancelamento_reversivel: true,
        plano_agendado: null,
        plano_agendado_para: null,
      })
      .eq("id", id);
    falha("assinaturas", error);
  }

  return {
    ok: true,
    status: plano.imediato ? "cancelada" : a.status,
    acesso_ate: plano.imediato ? null : plano.agendadoPara,
    cobrancas_apagadas: cobrancasApagadas,
  };
}

export async function reativarAssinatura(db: Db, id: string) {
  const a = await buscarAssinatura(db, id);
  if (a.status === "cancelada")
    throw new ErroCrm(409, "assinatura já cancelada não volta: precisa de nova contratação");
  if (!a.cancelamento_agendado_para) throw new ErroCrm(409, "não há cancelamento agendado");
  if (!a.cancelamento_reversivel)
    throw new ErroCrm(
      409,
      "o cliente cancelou pela tela Meu plano, que já apagou a assinatura no Asaas: precisa de nova contratação",
    );
  if (a.asaas_subscription_id) {
    await noAsaas(`/subscriptions/${a.asaas_subscription_id}`, {
      method: "PUT",
      body: JSON.stringify({ endDate: null }),
    });
  }
  const { error } = await db
    .from("assinaturas")
    .update({
      cancelamento_agendado_para: null,
      cancelamento_solicitado_em: null,
      cancelamento_motivo: null,
      cancelado_por: null,
      cancelamento_reversivel: false,
    })
    .eq("id", id);
  falha("assinaturas", error);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sincronização
// ---------------------------------------------------------------------------

type SubscriptionAsaas = {
  id: string;
  customer?: string;
  status?: string;
  nextDueDate?: string;
  deleted?: boolean;
};

/** Busca no Asaas a assinatura e as cobranças da clínica e atualiza o banco. */
export async function sincronizarComAsaas(db: Db, a: AssinaturaRow) {
  const sub = a.asaas_subscription_id;
  if (!sub && !a.asaas_customer_id)
    throw new ErroCrm(409, "esta assinatura não está ligada a um cliente do Asaas");

  const mudancas: Record<string, unknown> = { asaas_sincronizado_em: new Date().toISOString() };
  if (sub) {
    const s = await noAsaas<SubscriptionAsaas>(`/subscriptions/${sub}`);
    if (s.customer) mudancas.asaas_customer_id = s.customer;
    if (!s.deleted && s.status === "ACTIVE" && s.nextDueDate)
      mudancas.proxima_cobranca = s.nextDueDate;
    // Removida por fora e sem cancelamento agendado: mesmo efeito do webhook SUBSCRIPTION_DELETED.
    if (
      (s.deleted || s.status === "INACTIVE") &&
      !a.cancelamento_agendado_para &&
      a.status !== "cancelada"
    ) {
      mudancas.status = "cancelada";
      mudancas.cancelada_em = new Date().toISOString();
      mudancas.cancelado_por = "asaas";
    }
  }

  const filtro = sub
    ? `subscription=${encodeURIComponent(sub)}`
    : `customer=${encodeURIComponent(a.asaas_customer_id as string)}`;
  const cobrancas = (await cobrancasDoAsaas(filtro)).filter(
    (p): p is PaymentAsaas & { id: string } => !!p.id,
  );
  if (cobrancas.length) {
    const { error } = await db
      .from("asaas_cobrancas")
      .upsert(
        cobrancas.map((p) =>
          linhaDaCobranca(p, { medicoId: a.medico_id, assinaturaId: a.id }, "SINCRONIZACAO_CRM"),
        ),
      );
    falha("asaas_cobrancas", error);
  }

  const { error } = await db.from("assinaturas").update(mudancas).eq("id", a.id);
  falha("assinaturas", error);
  if (
    a.status === "inadimplente" &&
    !cobrancas.some((p) => p.status === "OVERDUE" && !p.deleted) &&
    cobrancas.some((p) => ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(p.status ?? ""))
  ) {
    await reativarSeInadimplente(db, a.medico_id);
  }
  return cobrancas.length;
}
