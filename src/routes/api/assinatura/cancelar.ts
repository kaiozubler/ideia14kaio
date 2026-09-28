import { createFileRoute } from "@tanstack/react-router";

import { asaasFetch, AsaasApiError, AsaasNaoConfiguradoError } from "@/lib/asaas/client.server";

export const Route = createFileRoute("/api/assinatura/cancelar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

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

        if (assinatura.asaas_subscription_id) {
          try {
            await asaasFetch(`/subscriptions/${assinatura.asaas_subscription_id}`, { method: "DELETE" });
          } catch (err) {
            if (err instanceof AsaasNaoConfiguradoError) return Response.json({ error: err.message }, { status: 501 });
            if (err instanceof AsaasApiError) return Response.json({ error: err.message }, { status: 502 });
            console.error("[assinatura:cancelar] erro inesperado:", err);
            return Response.json({ error: "erro inesperado" }, { status: 500 });
          }
        }

        const { error: erroUpdate } = await supabaseAdmin
          .from("assinaturas")
          .update({ status: "cancelada" })
          .eq("id", assinatura.id);

        if (erroUpdate) {
          console.error("[assinatura:cancelar] erro ao atualizar localmente:", erroUpdate.message);
          return Response.json({ error: "cancelado no Asaas, mas houve erro ao salvar localmente — avise o suporte" }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
