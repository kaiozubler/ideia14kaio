import { createFileRoute } from "@tanstack/react-router";

// Recebe os eventos do Asaas e atualiza as tabelas correspondentes. É o
// único lugar que confirma pagamento/cobrança de verdade — nunca o
// redirecionamento de volta (callback do Checkout), conforme o próprio
// Asaas recomenda.
//
// Eventos tratados:
//   CHECKOUT_PAID/CANCELED/EXPIRED   -> contratacoes (funil de assinatura
//                                       nova) OU creditos_adicionais (compra
//                                       avulsa de créditos, ver
//                                       /api/assinatura/comprar-creditos),
//                                       dependendo de qual tabela tem esse
//                                       asaas_checkout_id
//   PAYMENT_OVERDUE                  -> assinaturas.status = 'inadimplente'
//   PAYMENT_CONFIRMED/RECEIVED       -> assinaturas.status = 'ativa' de novo
//   PAYMENT_* (com payment.id)       -> asaas_cobrancas (histórico que o
//                                       Zubler CRM mostra ao lado dos
//                                       pagamentos manuais)
//   SUBSCRIPTION_DELETED/INACTIVATED -> assinaturas.status = 'cancelada'
//                                       (exceto cancelamento agendado pela
//                                       tela Meu plano, que mantém o acesso
//                                       até o fim do período pago)
//
// LACUNA CONHECIDA: o funil público (/planos -> /contratacao/*) não pede
// login em nenhum momento, então uma contratação nova não tem
// automaticamente um auth.users pra virar dona de uma linha em
// `assinaturas` (que exige medico_id not null, pra RLS funcionar). Por
// isso este webhook NÃO cria `assinaturas` sozinho a partir de
// CHECKOUT_PAID — só atualiza `contratacoes`. A linha em `assinaturas`
// precisa ser criada à parte (hoje, manualmente) quando a conta do médico
// é criada — ver aviso completo na resposta que acompanha este código.
//
// Configuração pendente no painel do Asaas: Webhooks -> eventos
// CHECKOUT_CREATED/PAID/CANCELED/EXPIRED, PAYMENT_OVERDUE/CONFIRMED/
// RECEIVED, SUBSCRIPTION_DELETED/INACTIVATED, apontando pra
// {seu domínio}/api/asaas/webhook. Se definir um token lá, replique em
// ASAAS_WEBHOOK_TOKEN.

type EventoAsaas = {
  event: string;
  checkout?: { id?: string };
  payment?: {
    id?: string;
    subscription?: string | null;
    value?: number;
    status?: string;
    billingType?: string;
    dueDate?: string;
    paymentDate?: string | null;
    clientPaymentDate?: string | null;
  };
  subscription?: { id?: string };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Guarda a cobrança recorrente para o Zubler CRM (/api/public/crm/pagamentos). Falha aqui não reenvia o evento. */
async function registrarCobranca(
  db: Db,
  evento: string,
  payment: NonNullable<EventoAsaas["payment"]>,
) {
  if (!payment.id) return;
  let medicoId: string | null = null;
  let assinaturaId: string | null = null;
  if (payment.subscription) {
    const { data } = await db
      .from("assinaturas")
      .select("id, medico_id")
      .eq("asaas_subscription_id", payment.subscription)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    medicoId = data?.medico_id ?? null;
    assinaturaId = data?.id ?? null;
  }
  const { error } = await db.from("asaas_cobrancas").upsert({
    asaas_payment_id: payment.id,
    asaas_subscription_id: payment.subscription ?? null,
    medico_id: medicoId,
    assinatura_id: assinaturaId,
    valor: payment.value ?? null,
    status: payment.status ?? null,
    metodo: payment.billingType ?? null,
    vencimento: payment.dueDate ?? null,
    pago_em: payment.paymentDate ?? payment.clientPaymentDate ?? null,
    ultimo_evento: evento,
    atualizado_em: new Date().toISOString(),
  });
  if (error) console.error("[asaas:webhook] erro ao registrar cobrança:", error.message);
}

export const Route = createFileRoute("/api/asaas/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const tokenEsperado = process.env["ASAAS_WEBHOOK_TOKEN"];
        if (tokenEsperado) {
          const tokenRecebido = request.headers.get("asaas-access-token");
          if (tokenRecebido !== tokenEsperado) {
            return Response.json({ error: "token inválido" }, { status: 401 });
          }
        }

        const corpo = (await request.json().catch(() => null)) as EventoAsaas | null;
        if (!corpo?.event) {
          console.error("[asaas:webhook] payload inesperado:", JSON.stringify(corpo));
          return Response.json({ ok: true });
        }

        const { supabaseAdmin: supabaseAdminTipado } = await import("@/integrations/supabase/client.server");
        // As tabelas assinaturas/creditos_adicionais/consumo_mensal ainda não constam no types.ts
        // gerado (só depois de rodar a migration + regenerar tipos) — remover este cast depois.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const supabaseAdmin = supabaseAdminTipado as any;

        // --- Checkout (assinatura nova OU compra avulsa de créditos) ---
        const checkoutId = corpo.checkout?.id;
        if (checkoutId && corpo.event.startsWith("CHECKOUT_")) {
          let status: "confirmada" | "cancelada" | null = null;
          if (corpo.event === "CHECKOUT_PAID") status = "confirmada";
          else if (corpo.event === "CHECKOUT_CANCELED" || corpo.event === "CHECKOUT_EXPIRED") status = "cancelada";

          if (status) {
            const { data: contratacao } = await supabaseAdmin
              .from("contratacoes")
              .select("id")
              .eq("asaas_checkout_id", checkoutId)
              .maybeSingle();

            if (contratacao) {
              const updates: { status: "confirmada" | "cancelada"; pagamento_confirmado_em?: string } = { status };
              if (status === "confirmada") updates.pagamento_confirmado_em = new Date().toISOString();
              const { error } = await supabaseAdmin.from("contratacoes").update(updates).eq("id", contratacao.id);
              if (error) console.error("[asaas:webhook] erro ao atualizar contratação:", error.message);
            } else {
              const statusCredito = status === "confirmada" ? "pago" : "cancelado";
              const { error } = await supabaseAdmin
                .from("creditos_adicionais")
                .update({ status: statusCredito })
                .eq("asaas_checkout_id", checkoutId);
              if (error) console.error("[asaas:webhook] erro ao atualizar créditos adicionais:", error.message);
            }
          }
        }

        // --- Cobrança da assinatura (pagamentos recorrentes, depois do primeiro) ---
        if (corpo.payment && corpo.event.startsWith("PAYMENT_")) {
          await registrarCobranca(supabaseAdmin, corpo.event, corpo.payment);
        }
        const subscriptionId = corpo.payment?.subscription ?? corpo.subscription?.id;
        if (subscriptionId) {
          if (corpo.event === "PAYMENT_OVERDUE") {
            const { error } = await supabaseAdmin
              .from("assinaturas")
              .update({
                status: "inadimplente",
                ultimo_erro_cobranca: { mensagem: "Cobrança em atraso — verifique a forma de pagamento.", em: new Date().toISOString() },
              })
              .eq("asaas_subscription_id", subscriptionId);
            if (error) console.error("[asaas:webhook] erro ao marcar inadimplência:", error.message);
          } else if (corpo.event === "PAYMENT_CONFIRMED" || corpo.event === "PAYMENT_RECEIVED") {
            const { error } = await supabaseAdmin
              .from("assinaturas")
              .update({ status: "ativa", ultimo_erro_cobranca: null })
              .eq("asaas_subscription_id", subscriptionId)
              .eq("status", "inadimplente");
            if (error) console.error("[asaas:webhook] erro ao reativar assinatura:", error.message);
          } else if (corpo.event === "SUBSCRIPTION_DELETED" || corpo.event === "SUBSCRIPTION_INACTIVATED") {
            // Cancelamento pedido pela tela Meu plano já agenda o fim do acesso
            // (cancelamento_agendado_para) — não antecipa aqui; só cancela na hora
            // o que foi removido por fora (painel do Asaas, etc.).
            const { error } = await supabaseAdmin
              .from("assinaturas")
              .update({ status: "cancelada" })
              .eq("asaas_subscription_id", subscriptionId)
              .is("cancelamento_agendado_para", null);
            if (error) console.error("[asaas:webhook] erro ao cancelar assinatura:", error.message);
          }
        }

        return Response.json({ ok: true });
      },
    },
  },
});
