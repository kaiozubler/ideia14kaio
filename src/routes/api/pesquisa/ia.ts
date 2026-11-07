import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { autenticarPesquisa } from "@/lib/pesquisa/auth.server";
import { pesquisarBase } from "@/lib/pesquisa/base.server";
import { chamarIA, provedorDoUsuario } from "@/lib/ia/provedor.server";

// Visão geral da IA no topo dos resultados (como o resumo do Google). Usa o
// modelo escolhido pelo médico em Minhas IAs e, quando a fonte "Base de
// conhecimento" está marcada, os trechos das bases dele como insumo.
const Schema = z.object({
  q: z.string().trim().min(2).max(300),
  usar_base: z.boolean().optional(),
});

const MARCADOR = "[[BASES:";

export const Route = createFileRoute("/api/pesquisa/ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ error: "ia_indisponivel" }, { status: 500 });

        let contexto = "";
        if (body.usar_base) {
          try {
            const trechos = await pesquisarBase(auth.client, body.q, 5);
            if (trechos.length) {
              contexto =
                "\n\nTrechos da base de conhecimento do próprio médico (podem não ter relação real com a pesquisa):\n" +
                trechos
                  .map((t, i) => `[${i + 1}] base "${t.base_nome}" — ${t.titulo}\n${t.descricao}`)
                  .join("\n\n") +
                `\n\nUse um trecho só se ele de fato responder à pesquisa. Se usar algum, termine com uma linha` +
                ` sozinha no formato ${MARCADOR}nome da base; outra base]] e nada depois dela.`;
            }
          } catch (err) {
            console.warn(
              "[pesquisa/ia] base indisponível:",
              err instanceof Error ? err.message : err,
            );
          }
        }

        try {
          const texto = await chamarIA(
            provedorDoUsuario(auth.metadata),
            [
              {
                role: "system",
                content:
                  "Você gera a visão geral que aparece no topo de uma pesquisa feita por um médico, como o resumo de IA" +
                  " de um buscador. Responda em português do Brasil, direto ao ponto, em no máximo 180 palavras:" +
                  " um parágrafo curto que responde à pesquisa e, se ajudar, até 5 tópicos com os pontos principais" +
                  " (use **negrito** com moderação). Não faça perguntas de volta, não cumprimente, não repita a pesquisa." +
                  " Se a pesquisa for ambígua, responda a interpretação clínica mais provável. Não invente doses," +
                  " referências ou números de que não tem certeza." +
                  contexto,
              },
              { role: "user", content: body.q },
            ],
            apiKey,
            "low",
          );
          let resumo = texto.trim();
          let bases: string[] = [];
          const i = resumo.lastIndexOf(MARCADOR);
          if (i >= 0) {
            bases = resumo
              .slice(i + MARCADOR.length)
              .replace(/\]\]\s*$/, "")
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean);
            resumo = resumo.slice(0, i).trim();
          }
          return Response.json({ resumo, bases });
        } catch (err) {
          if (err instanceof Response) {
            console.error("[pesquisa/ia]", err.status, await err.text());
            return Response.json({ error: "ia_falhou" }, { status: 502 });
          }
          console.error("[pesquisa/ia]", err instanceof Error ? err.message : err);
          return Response.json({ error: "ia_falhou" }, { status: 502 });
        }
      },
    },
  },
});
