import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { asaasFetch, AsaasApiError, AsaasNaoConfiguradoError } from "@/lib/asaas/client.server";
import { PLANOS_BASE } from "@/lib/plans/config";

// Troca o plano da assinatura ATIVA de quem está logado (upgrade ou
// downgrade — mesma rota, só muda o plano de destino). Atualiza o VALOR da
// assinatura no Asaas (PUT /v3/subscriptions/{id}) e espelha localmente.
//
// Escopo desta v1: só troca entre os 3 planos prontos (Basic/Pro/
// Enterprise), com a configuração de fábrica de cada um — não suporta
// trocar pra uma config à la carte personalizada a partir daqui (isso
// continua sendo feito, hoje, refazendo a contratação em /planos).

const BodySchema = z.object({ novoPlano: z.enum(["basic", "pro", "enterprise"]) });

export const Route = createFileRoute("/api/assinatura/trocar-plano")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = BodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: assinatura, error: erroBusca } = await supabaseAdmin
          .from("assinaturas")
          .select("*")
          .eq("medico_id", userId)
          .neq("status", "cancelada")
          .maybeSingle();

        if (erroBusca || !assinatura) {
          return Response.json({ error: "nenhuma assinatura ativa encontrada" }, { status: 404 });
        }
        if (!assinatura.asaas_subscription_id) {
          return Response.json({ error: "assinatura sem cobrança recorrente vinculada ainda" }, { status: 409 });
        }

        const novo = PLANOS_BASE.find((p) => p.id === body.data.novoPlano);
        if (!novo) return Response.json({ error: "plano inválido" }, { status: 400 });

        if (novo.id === assinatura.plano) {
          return Response.json({ error: "você já está nesse plano" }, { status: 400 });
        }

        try {
          await asaasFetch(`/subscriptions/${assinatura.asaas_subscription_id}`, {
            method: "PUT",
            body: JSON.stringify({
              value: novo.precoMensal,
              description: `MediCopilot — plano ${novo.nome}`,
            }),
          });
        } catch (err) {
          if (err instanceof AsaasNaoConfiguradoError) return Response.json({ error: err.message }, { status: 501 });
          if (err instanceof AsaasApiError) return Response.json({ error: err.message }, { status: 502 });
          console.error("[assinatura:trocar-plano] erro inesperado:", err);
          return Response.json({ error: "erro inesperado" }, { status: 500 });
        }

        const { error: erroUpdate } = await supabaseAdmin
          .from("assinaturas")
          .update({
            plano: novo.id,
            medicos: novo.medicos,
            secretarias: novo.secretarias,
            copiloto: novo.copiloto,
            whatsapp: novo.whatsapp,
            video: novo.video,
            preco_mensal: novo.precoMensal,
          })
          .eq("id", assinatura.id);

        if (erroUpdate) {
          console.error("[assinatura:trocar-plano] erro ao atualizar localmente:", erroUpdate.message);
          return Response.json({ error: "plano trocado no Asaas, mas houve erro ao salvar localmente — avise o suporte" }, { status: 500 });
        }

        return Response.json({ ok: true, plano: novo.id });
      },
    },
  },
});
