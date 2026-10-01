import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Ações sobre a conexão da clínica com a Meta:
 *   { acao: "testar" }                     lê número + WABA com o token salvo e marca "conectado"/"erro"
 *   { acao: "assinar_webhook" }            POST /{waba}/subscribed_apps (faz a Meta mandar eventos ao app)
 *   { acao: "registrar_numero", pin }      POST /{phone}/register (números novos na Cloud API)
 */
export const Route = createFileRoute("/api/comunicacao/conexao-acao")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: { acao?: string; pin?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const meta = await import("@/lib/comunicacao/meta.server");
        const { respostaDeErro } = await import("@/lib/comunicacao/envio.server");
        const db = supabaseAdmin as any;

        const c = await meta.carregarConexao(db, userId).catch(() => null);
        if (!c || !c.accessToken || !c.phone_number_id) {
          return Response.json(
            { error: "sem_conexao", message: "Salve as credenciais da Meta antes de testar." },
            { status: 400 },
          );
        }

        try {
          if (body.acao === "testar") {
            try {
              const dados = await meta.lerDadosNumero(c);
              await db
                .from("comunicacao_whatsapp_conexoes")
                .update({
                  numero_exibicao: dados.numero_exibicao,
                  nome_verificado: dados.nome_verificado,
                  nome_waba: dados.nome_waba,
                  quality_rating: dados.quality_rating,
                  messaging_limit_tier: dados.messaging_limit_tier,
                  status: "conectado",
                  ultimo_erro: null,
                  testado_em: new Date().toISOString(),
                })
                .eq("id_medico", userId);
              return Response.json({ ok: true, ...dados });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await db
                .from("comunicacao_whatsapp_conexoes")
                .update({ status: "erro", ultimo_erro: msg, testado_em: new Date().toISOString() })
                .eq("id_medico", userId);
              throw e;
            }
          }

          if (body.acao === "assinar_webhook") {
            await meta.assinarWebhookNaWaba(c);
            await db
              .from("comunicacao_whatsapp_conexoes")
              .update({ webhook_assinado_em: new Date().toISOString() })
              .eq("id_medico", userId);
            return Response.json({ ok: true });
          }

          if (body.acao === "registrar_numero") {
            await meta.registrarNumero(c, String(body.pin || ""));
            return Response.json({ ok: true });
          }

          return Response.json({ error: "acao_invalida" }, { status: 400 });
        } catch (e) {
          return respostaDeErro(e);
        }
      },
    },
  },
});
