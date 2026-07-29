import { createFileRoute } from "@tanstack/react-router";

type Body = {
  action?: "listar" | "obter" | "favoritar";
  user_id?: string | null;
  conversa_id?: string;
  favorito?: boolean;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const Route = createFileRoute("/api/assistente-ia-conversas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const medicoId = body.user_id || null;
        if (!medicoId) return new Response("Usuário não identificado", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Limpeza preguiçosa: conversas não favoritadas com mais de 7 dias somem.
        // Roda a cada chamada em vez de depender de um job agendado à parte.
        const limite = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
        await supabaseAdmin
          .from("ia_assist_conversas")
          .delete()
          .eq("id_medico", medicoId)
          .eq("favorito", false)
          .lt("updated_at", limite);

        switch (body.action) {
          case "listar": {
            const { data, error } = await supabaseAdmin
              .from("ia_assist_conversas")
              .select("id,titulo,favorito,updated_at")
              .eq("id_medico", medicoId)
              .order("updated_at", { ascending: false })
              .limit(60);
            if (error) return new Response(error.message, { status: 500 });
            return Response.json({ conversas: data || [] });
          }

          case "obter": {
            if (!body.conversa_id) return new Response("conversa_id obrigatório", { status: 400 });
            const { data, error } = await supabaseAdmin
              .from("ia_assist_conversas")
              .select("id,titulo,favorito,mensagens")
              .eq("id_medico", medicoId)
              .eq("id", body.conversa_id)
              .maybeSingle();
            if (error) return new Response(error.message, { status: 500 });
            if (!data) return new Response("Conversa não encontrada", { status: 404 });
            return Response.json(data);
          }

          case "favoritar": {
            if (!body.conversa_id) return new Response("conversa_id obrigatório", { status: 400 });
            const { error } = await supabaseAdmin
              .from("ia_assist_conversas")
              .update({ favorito: !!body.favorito })
              .eq("id_medico", medicoId)
              .eq("id", body.conversa_id);
            if (error) return new Response(error.message, { status: 500 });
            return Response.json({ ok: true });
          }

          default:
            return new Response("Ação inválida", { status: 400 });
        }
      },
    },
  },
});
