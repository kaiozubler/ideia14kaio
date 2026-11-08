import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { autenticarPesquisa } from "@/lib/pesquisa/auth.server";
import { FONTES_EXTERNAS, pesquisarFonte } from "@/lib/pesquisa/fontes.server";

const Schema = z.object({
  fonte: z.enum(FONTES_EXTERNAS),
  q: z.string().trim().min(2).max(300),
});

export const Route = createFileRoute("/api/pesquisa/fonte")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Exige login: a consulta passa pela IA (tradução para inglês), que gasta a chave da conta.
        const auth = await autenticarPesquisa(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: z.infer<typeof Schema>;
        try {
          const parsed = Schema.safeParse(await request.json());
          if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
          body = parsed.data;
        } catch {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        try {
          return Response.json(await pesquisarFonte(body.fonte, body.q));
        } catch (err) {
          console.error(`[pesquisa/fonte:${body.fonte}]`, err instanceof Error ? err.message : err);
          return Response.json({ error: "fonte_indisponivel" }, { status: 502 });
        }
      },
    },
  },
});
