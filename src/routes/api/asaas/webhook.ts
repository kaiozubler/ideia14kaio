import { createFileRoute } from "@tanstack/react-router";

// Recebe os eventos de Checkout do Asaas (CHECKOUT_PAID/CANCELED/EXPIRED/
// CREATED) e atualiza a linha correspondente em `contratacoes`.
//
// Isso — e só isso — é quem confirma pagamento de verdade. O
// `successUrl`/`callback` do Checkout (ver /api/asaas/checkout) só melhora
// a navegação de quem pagou; conforme o próprio Asaas recomenda, nunca
// marcamos um pedido como pago só por causa do redirecionamento.
//
// AINDA PRECISA SER CONFIGURADO NO PAINEL DO ASAAS depois que a chave de
// API estiver ativa: Configurações → Integrações → Webhooks → criar um
// apontando pra {seu domínio}/api/asaas/webhook, eventos CHECKOUT_CREATED,
// CHECKOUT_PAID, CHECKOUT_CANCELED, CHECKOUT_EXPIRED. Se você definir um
// "Token de acesso" na configuração do Webhook, defina a mesma string na
// variável de ambiente ASAAS_WEBHOOK_TOKEN — com isso ligado, requisições
// sem o header correto são rejeitadas.

type EventoCheckout = {
  id: string;
  event: "CHECKOUT_CREATED" | "CHECKOUT_PAID" | "CHECKOUT_CANCELED" | "CHECKOUT_EXPIRED" | string;
  checkout?: { id?: string; status?: string };
};

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

        const corpo = (await request.json().catch(() => null)) as EventoCheckout | null;
        const checkoutId = corpo?.checkout?.id;

        if (!corpo || !corpo.event || !checkoutId) {
          // Corpo que não reconhecemos — devolve 200 mesmo assim (o Asaas reenvia
          // em loop se não receber 2xx) mas loga pra investigar depois.
          console.error("[asaas:webhook] payload inesperado:", JSON.stringify(corpo));
          return Response.json({ ok: true });
        }

        let status: "confirmada" | "cancelada" | null = null;
        if (corpo.event === "CHECKOUT_PAID") status = "confirmada";
        else if (corpo.event === "CHECKOUT_CANCELED" || corpo.event === "CHECKOUT_EXPIRED") status = "cancelada";
        // CHECKOUT_CREATED e qualquer evento futuro desconhecido: sem ação, só confirma recebimento.

        if (status) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const updates: Record<string, unknown> = { status };
          if (status === "confirmada") updates.pagamento_confirmado_em = new Date().toISOString();

          const { error } = await supabaseAdmin.from("contratacoes").update(updates).eq("asaas_checkout_id", checkoutId);
          if (error) {
            console.error("[asaas:webhook] erro ao atualizar contratação:", error.message, "checkoutId:", checkoutId);
          }
        }

        return Response.json({ ok: true });
      },
    },
  },
});
