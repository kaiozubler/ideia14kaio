import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Baixa a mídia de uma mensagem (foto, áudio, PDF enviado pelo paciente).
 * A URL da Meta exige o token da clínica e expira em minutos, então o
 * navegador nunca a recebe: esta rota faz o download e devolve os bytes.
 * GET ?mensagem_id=<uuid>
 */
export const Route = createFileRoute("/api/comunicacao/midia")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        const id = new URL(request.url).searchParams.get("mensagem_id");
        if (!id) return Response.json({ error: "mensagem_id obrigatório" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const meta = await import("@/lib/comunicacao/meta.server");
        const { respostaDeErro } = await import("@/lib/comunicacao/envio.server");
        const db = supabaseAdmin as any;
        const { data: msg } = await db
          .from("comunicacao_whatsapp_mensagens")
          .select("midia")
          .eq("id", id)
          .eq("id_medico", userId)
          .maybeSingle();
        const mediaId = msg?.midia?.id;
        if (!mediaId) return Response.json({ error: "sem_midia" }, { status: 404 });
        try {
          const c = await meta.carregarConexao(db, userId);
          if (!c?.accessToken) return Response.json({ error: "sem_conexao" }, { status: 400 });
          const { bytes, mime } = await meta.baixarMidia(c, mediaId);
          const nome = String(msg.midia.filename || "arquivo").replace(/[^\w.\- ]+/g, "_");
          return new Response(bytes as BodyInit, {
            headers: {
              "Content-Type": mime,
              "Content-Disposition": `inline; filename="${nome}"`,
              "Cache-Control": "private, max-age=300",
            },
          });
        } catch (e) {
          return respostaDeErro(e);
        }
      },
    },
  },
});
