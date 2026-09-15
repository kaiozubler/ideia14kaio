import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Salvar/listar/carregar rascunhos do grafo do Studio de protocolo
// (protocolo-studio.html). Ferramenta experimental e paralela ao fluxo
// oficial — ver supabase/migrations/20260915140000_protocolo-studio-grafo-rascunhos.sql
// para o motivo do grafo inteiro ficar em um único jsonb por enquanto.
//
// GET  /api/protocolos/estudio-rascunho          -> lista rascunhos do usuário (sem o grafo, só metadados)
// GET  /api/protocolos/estudio-rascunho?id=UUID  -> carrega um rascunho específico (com o grafo)
// POST /api/protocolos/estudio-rascunho          -> cria (sem id) ou atualiza (com id)

const SaveSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  titulo: z.string().min(1).max(200),
  grafo: z.object({
    nodes: z.array(z.record(z.any())),
    edges: z.array(z.record(z.any())),
  }),
});

export const Route = createFileRoute("/api/protocolos/estudio-rascunho")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const url = new URL(request.url);
        const id = url.searchParams.get("id");

        if (id) {
          const { data, error } = await supabaseAdmin
            .from("protocolo_estudio_rascunhos")
            .select("id,titulo,grafo,created_at,updated_at")
            .eq("id", id)
            .eq("user_id", userId)
            .maybeSingle();
          if (error) return Response.json({ error: "internal_error" }, { status: 500 });
          if (!data) return Response.json({ error: "not_found" }, { status: 404 });
          return Response.json(data);
        }

        const { data, error } = await supabaseAdmin
          .from("protocolo_estudio_rascunhos")
          .select("id,titulo,created_at,updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });
        if (error) return Response.json({ error: "internal_error" }, { status: 500 });
        return Response.json({ rascunhos: data || [] });
      },

      POST: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = SaveSchema.safeParse(await request.json());
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (body.data.id) {
          const { data, error } = await supabaseAdmin
            .from("protocolo_estudio_rascunhos")
            .update({ titulo: body.data.titulo, grafo: body.data.grafo })
            .eq("id", body.data.id)
            .eq("user_id", userId)
            .select("id,titulo,updated_at")
            .maybeSingle();
          if (error) return Response.json({ error: "internal_error" }, { status: 500 });
          if (!data) return Response.json({ error: "not_found" }, { status: 404 });
          return Response.json(data);
        }

        const { data, error } = await supabaseAdmin
          .from("protocolo_estudio_rascunhos")
          .insert({ user_id: userId, titulo: body.data.titulo, grafo: body.data.grafo })
          .select("id,titulo,updated_at")
          .single();
        if (error) return Response.json({ error: "internal_error" }, { status: 500 });
        return Response.json(data);
      },
    },
  },
});
