import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Leitura pública (somente dados seguros) de um formulário ativo.
// Roda no servidor para que a função de banco não precise ficar exposta a visitantes.
const QuerySchema = z.object({ id: z.string().uuid() });

export const Route = createFileRoute("/api/public/formularios/publico")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({ id: url.searchParams.get("id") });
        if (!parsed.success) return Response.json({ error: "invalid_id" }, { status: 400 });
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await (supabaseAdmin as any).rpc("formulario_publico", {
            p_id: parsed.data.id,
          });
          if (error) throw error;
          if (!data) return Response.json({ error: "not_found" }, { status: 404 });
          return Response.json({ formulario: data });
        } catch (e) {
          console.error("[formularios/publico]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
