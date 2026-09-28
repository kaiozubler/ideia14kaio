import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { asaasFetch, ambienteAsaas, AsaasApiError, AsaasNaoConfiguradoError } from "@/lib/asaas/client.server";
import { pacotesCredito } from "@/lib/plans/config";

// Compra avulsa de créditos extras (Copiloto/WhatsApp/Vídeo), que somam ao
// saldo atual em vez de substituir a franquia mensal do plano — ver
// registrar_consumo() na migration de assinaturas pra entender a ordem de
// consumo (franquia do plano primeiro, depois esse crédito).
//
// Preço vem sempre de pacotesCredito() (mesmos degraus já usados em
// /planos), nunca inventado aqui.

const BodySchema = z.object({
  recurso: z.enum(["copiloto", "whatsapp", "video"]),
  quantidade: z.number().int().positive(),
});

export const Route = createFileRoute("/api/assinatura/comprar-creditos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = BodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const pacote = pacotesCredito(body.data.recurso).find((p) => p.quantidade === body.data.quantidade);
        if (!pacote) return Response.json({ error: "pacote de créditos inválido" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: assinatura, error: erroBusca } = await supabaseAdmin
          .from("assinaturas")
          .select("id, asaas_customer_id")
          .eq("medico_id", userId)
          .neq("status", "cancelada")
          .maybeSingle();

        if (erroBusca || !assinatura) {
          return Response.json({ error: "nenhuma assinatura ativa encontrada" }, { status: 404 });
        }

        const nomesRecurso: Record<string, string> = { copiloto: "consultas de Copiloto", whatsapp: "conversas de WhatsApp", video: "min de vídeo" };
        const origin = new URL(request.url).origin;

        try {
          const checkout = await asaasFetch<{ id: string }>("/checkouts", {
            method: "POST",
            body: JSON.stringify({
              billingTypes: ["CREDIT_CARD"],
              chargeTypes: ["DETACHED"], // cobrança única, não recorrente
              minutesToExpire: 60,
              callback: {
                successUrl: `${origin}/`,
                cancelUrl: `${origin}/`,
                expiredUrl: `${origin}/`,
              },
              items: [
                {
                  name: `MediCopilot — crédito extra: +${pacote.quantidade} ${nomesRecurso[body.data.recurso]}`,
                  description: "Crédito avulso, não expira ao fim do mês — some ao saldo atual.",
                  quantity: 1,
                  value: pacote.preco,
                },
              ],
              customer: assinatura.asaas_customer_id || undefined,
            }),
          });

          const { error: erroInsert } = await supabaseAdmin.from("creditos_adicionais").insert({
            assinatura_id: assinatura.id,
            recurso: body.data.recurso,
            quantidade: pacote.quantidade,
            valor_pago: pacote.preco,
            status: "pendente",
            asaas_checkout_id: checkout.id,
          });
          if (erroInsert) {
            console.error("[assinatura:comprar-creditos] erro ao registrar compra pendente:", erroInsert.message);
          }

          const dominioCheckout = ambienteAsaas() === "production" ? "https://www.asaas.com" : "https://sandbox.asaas.com";
          return Response.json({ checkoutUrl: `${dominioCheckout}/checkoutSession/show?id=${checkout.id}` });
        } catch (err) {
          if (err instanceof AsaasNaoConfiguradoError) return Response.json({ error: err.message }, { status: 501 });
          if (err instanceof AsaasApiError) return Response.json({ error: err.message }, { status: 502 });
          console.error("[assinatura:comprar-creditos] erro inesperado:", err);
          return Response.json({ error: "erro inesperado" }, { status: 500 });
        }
      },
    },
  },
});
