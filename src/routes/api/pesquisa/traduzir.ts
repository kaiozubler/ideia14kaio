import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { autenticarPesquisa } from "@/lib/pesquisa/auth.server";
import { chamarIA } from "@/lib/ia/provedor.server";

// Tradução para português dos resultados de portais em inglês (PubMed e os
// que vierem). Uma chamada só para o bloco inteiro, num modelo rápido.
const Schema = z.object({
  itens: z
    .array(
      z.object({
        id: z.string().max(40),
        titulo: z.string().max(600),
        descricao: z.string().max(1200),
      }),
    )
    .min(1)
    .max(10),
});

type Traducao = { id: string; titulo: string; descricao: string };

function lerJson(texto: string): Traducao[] | null {
  const ini = texto.indexOf("[");
  const fim = texto.lastIndexOf("]");
  if (ini < 0 || fim <= ini) return null;
  try {
    const v = JSON.parse(texto.slice(ini, fim + 1)) as unknown;
    if (!Array.isArray(v)) return null;
    return v
      .filter(
        (x): x is Traducao =>
          !!x && typeof x === "object" && typeof (x as Traducao).id === "string",
      )
      .map((x) => ({
        id: x.id,
        titulo: String(x.titulo ?? ""),
        descricao: String(x.descricao ?? ""),
      }));
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/pesquisa/traduzir")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await autenticarPesquisa(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
        let itens: z.infer<typeof Schema>["itens"];
        try {
          const parsed = Schema.safeParse(await request.json());
          if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
          itens = parsed.data.itens;
        } catch {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ error: "ia_indisponivel" }, { status: 500 });
        try {
          const texto = await chamarIA(
            "gemini",
            [
              {
                role: "system",
                content:
                  "Traduza para português do Brasil o título e a descrição de cada item, com terminologia médica" +
                  " usada no Brasil. Mantenha números, doses, unidades, siglas de estudos e nomes próprios exatamente" +
                  " como estão. Responda somente com um array JSON no formato" +
                  ' [{"id":"...","titulo":"...","descricao":"..."}], com os mesmos ids, sem texto fora do JSON.',
              },
              { role: "user", content: JSON.stringify(itens) },
            ],
            apiKey,
            "low",
          );
          const traducoes = lerJson(texto);
          if (!traducoes) return Response.json({ error: "traducao_invalida" }, { status: 502 });
          const ids = new Set(itens.map((i) => i.id));
          return Response.json({ traducoes: traducoes.filter((t) => ids.has(t.id)) });
        } catch (err) {
          console.error("[pesquisa/traduzir]", err instanceof Error ? err.message : err);
          return Response.json({ error: "traducao_falhou" }, { status: 502 });
        }
      },
    },
  },
});
