import { createFileRoute } from "@tanstack/react-router";

import { asaasFetch } from "@/lib/asaas/client.server";
import {
  assinaturaAtiva,
  clienteAdmin,
  respostaErroAsaas,
  salvarTokenCartao,
  tokenCartao,
  usuarioDaRequisicao,
} from "@/lib/assinatura/gestao.server";

// Dados financeiros da assinatura de quem está logado, direto do Asaas
// (fonte da verdade das cobranças): histórico de faturas (mensalidades e
// compras avulsas de crédito), data da próxima cobrança e cartão em uso.
//
// De quebra sincroniza localmente `proxima_cobranca` (usada pra agendar
// downgrade/cancelamento) e o cartão exibido, que nenhum webhook preenche.

type PagamentoAsaas = {
  id: string;
  dateCreated?: string;
  dueDate?: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  value?: number;
  status?: string;
  billingType?: string;
  description?: string | null;
  invoiceUrl?: string | null;
  transactionReceiptUrl?: string | null;
  subscription?: string | null;
  creditCard?: {
    creditCardNumber?: string;
    creditCardBrand?: string;
    creditCardToken?: string;
  } | null;
};

type Lista<T> = { data?: T[] };
type AssinaturaAsaas = { nextDueDate?: string; deleted?: boolean; status?: string };

export const Route = createFileRoute("/api/assinatura/financeiro")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await usuarioDaRequisicao(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const assinatura = await assinaturaAtiva(userId);
        if (!assinatura)
          return Response.json({ error: "nenhuma assinatura ativa encontrada" }, { status: 404 });

        const filtro = assinatura.asaas_customer_id
          ? `customer=${encodeURIComponent(assinatura.asaas_customer_id)}`
          : assinatura.asaas_subscription_id
            ? `subscription=${encodeURIComponent(assinatura.asaas_subscription_id)}`
            : null;

        let pagamentos: PagamentoAsaas[] = [];
        let proximaCobranca: string | null = assinatura.proxima_cobranca ?? null;
        try {
          if (filtro) {
            const lista = await asaasFetch<Lista<PagamentoAsaas>>(`/payments?${filtro}&limit=36`);
            pagamentos = lista.data ?? [];
          }
          if (assinatura.asaas_subscription_id && !assinatura.cancelamento_agendado_para) {
            const sub = await asaasFetch<AssinaturaAsaas>(
              `/subscriptions/${assinatura.asaas_subscription_id}`,
            );
            if (!sub.deleted && sub.nextDueDate) proximaCobranca = sub.nextDueDate;
          }
        } catch (err) {
          return respostaErroAsaas("financeiro", err);
        }

        pagamentos.sort((a, b) => String(b.dueDate ?? "").localeCompare(String(a.dueDate ?? "")));

        let bandeira: string | null = assinatura.cartao_bandeira ?? null;
        let final: string | null = assinatura.cartao_final ?? null;
        if (!final) {
          const comCartao = pagamentos.find(
            (p) => p.subscription && p.creditCard?.creditCardNumber,
          );
          if (comCartao?.creditCard) {
            bandeira = comCartao.creditCard.creditCardBrand ?? null;
            final = String(comCartao.creditCard.creditCardNumber).slice(-4);
          }
        }

        // Token pra compra avulsa com o cartão cadastrado: se ainda não temos,
        // aproveita o da cobrança mais recente paga com o mesmo cartão (o Asaas
        // só devolve creditCardToken quando a tokenização está ativa na conta).
        let token = await tokenCartao(assinatura.id);
        if (!token && final) {
          const comToken = pagamentos.find(
            (p) =>
              p.creditCard?.creditCardToken &&
              String(p.creditCard.creditCardNumber ?? "").slice(-4) === final,
          );
          if (comToken?.creditCard?.creditCardToken) {
            token = comToken.creditCard.creditCardToken;
            await salvarTokenCartao(assinatura.id, token);
          }
        }

        const updates: Record<string, string | null> = {};
        if (
          proximaCobranca &&
          proximaCobranca !== assinatura.proxima_cobranca &&
          !assinatura.cancelamento_agendado_para
        ) {
          updates.proxima_cobranca = proximaCobranca;
        }
        if (final && final !== assinatura.cartao_final) {
          updates.cartao_final = final;
          updates.cartao_bandeira = bandeira;
        }
        if (Object.keys(updates).length) {
          const supabaseAdmin = await clienteAdmin();
          const { error } = await supabaseAdmin
            .from("assinaturas")
            .update(updates)
            .eq("id", assinatura.id);
          if (error) console.error("[assinatura:financeiro] erro ao sincronizar:", error.message);
        }

        return Response.json({
          proximaCobranca,
          cartao: final ? { bandeira, final } : null,
          cartaoSalvoDisponivel: !!token && !!assinatura.asaas_customer_id,
          pagamentos: pagamentos.map((p) => ({
            id: p.id,
            vencimento: p.dueDate ?? null,
            pagoEm: p.clientPaymentDate ?? p.paymentDate ?? null,
            valor: Number(p.value ?? 0),
            status: p.status ?? "PENDING",
            forma: p.billingType ?? null,
            descricao: p.description ?? null,
            tipo: p.subscription ? "mensalidade" : "avulso",
            faturaUrl: p.invoiceUrl ?? null,
            reciboUrl: p.transactionReceiptUrl ?? null,
          })),
        });
      },
    },
  },
});
