import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook da WhatsApp Cloud API para o canal CLÍNICA ↔ PACIENTE.
 *
 * Cada clínica cadastra no PRÓPRIO App da Meta a URL
 *   /api/public/webhooks/whatsapp-clinica/<webhook_chave>
 * com o verify token mostrado em Configurações > WhatsApp dos pacientes.
 * A chave na URL identifica a conexão (a verificação GET da Meta não traz
 * phone_number_id); o POST é validado com o App Secret DAQUELA clínica.
 *
 * Não confundir com /api/whatsapp-webhook (autoatendimento com o token global
 * do app) nem com /api/assistente-medico-webhook (médico ↔ assistente).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function conexaoPelaChave(chave: string) {
  if (!UUID.test(chave)) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data } = await db
    .from("comunicacao_whatsapp_conexoes")
    .select("id_medico")
    .eq("webhook_chave", chave)
    .maybeSingle();
  if (!data) return null;
  const { carregarConexao } = await import("@/lib/comunicacao/meta.server");
  const c = await carregarConexao(db, data.id_medico);
  return c ? { db, c } : null;
}

export const Route = createFileRoute("/api/public/webhooks/whatsapp-clinica/$chave")({
  server: {
    handlers: {
      // Handshake de verificação exigido pela Meta ao salvar a URL de callback.
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const r = await conexaoPelaChave(params.chave);
        if (!r || mode !== "subscribe" || !token || token !== r.c.verify_token) {
          return new Response("Forbidden", { status: 403 });
        }
        await r.db
          .from("comunicacao_whatsapp_conexoes")
          .update({ webhook_verificado_em: new Date().toISOString() })
          .eq("id_medico", r.c.id_medico);
        return new Response(challenge || "", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },

      POST: async ({ request, params }) => {
        const corpo = await request.text();
        const r = await conexaoPelaChave(params.chave);
        if (!r) return new Response("Not found", { status: 404 });
        // App Secret é obrigatório neste canal: sem ele, qualquer um que
        // descobrisse a URL poderia injetar mensagens falsas de "pacientes".
        if (!r.c.appSecret) return new Response("App secret not configured", { status: 401 });
        const { verificarAssinatura, processarEventos } =
          await import("@/lib/comunicacao/webhook.server");
        const ok = await verificarAssinatura(
          r.c.appSecret,
          request.headers.get("x-hub-signature-256"),
          corpo,
        );
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let body: unknown;
        try {
          body = JSON.parse(corpo);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        try {
          await processarEventos(r.db, r.c, body);
        } catch (e) {
          // Responde 200 mesmo assim: um 5xx faria a Meta reentregar por dias.
          console.error("[whatsapp-clinica] erro ao processar webhook:", e);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
