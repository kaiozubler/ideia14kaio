import { createFileRoute } from "@tanstack/react-router";
import { autenticarPesquisa, lerConsulta } from "@/lib/pesquisa/auth.server";
import { pesquisarBase } from "@/lib/pesquisa/base.server";

export const Route = createFileRoute("/api/pesquisa/base")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await autenticarPesquisa(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
        const q = await lerConsulta(request);
        if (!q) return Response.json({ error: "invalid_body" }, { status: 400 });
        try {
          const resultados = await pesquisarBase(auth.client, q);
          return Response.json({ resultados });
        } catch (err) {
          console.error("[pesquisa/base]", err instanceof Error ? err.message : err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
