import { createFileRoute } from "@tanstack/react-router";
import { autenticarPesquisa, lerConsulta } from "@/lib/pesquisa/auth.server";
import { buscarPubmed } from "@/lib/pesquisa/pubmed.server";
import { chamarIA } from "@/lib/ia/provedor.server";

// O PubMed indexa em inglês e não traduz consultas em português: "enxaqueca
// crônica" não acha nada. Um modelo rápido converte a consulta antes; se a IA
// falhar ou demorar, busca com o texto original.
async function consultaEmIngles(q: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  const traducao = chamarIA(
    "gemini",
    [
      {
        role: "system",
        content:
          "Converta a pesquisa do médico em uma consulta para o PubMed, em inglês, usando termos MeSH quando houver" +
          " e operadores AND/OR quando ajudarem. Responda somente com a consulta, em uma linha, sem aspas nem explicação.",
      },
      { role: "user", content: q },
    ],
    key,
    "low",
  )
    .then(
      (t) =>
        t
          .replace(/[\r\n`]+/g, " ")
          .trim()
          .slice(0, 300) || null,
    )
    .catch((err) => {
      console.warn("[pesquisa/pubmed] tradução falhou:", err instanceof Error ? err.message : err);
      return null;
    });
  const limite = new Promise<null>((r) => setTimeout(() => r(null), 6000));
  return Promise.race([traducao, limite]);
}

export const Route = createFileRoute("/api/pesquisa/pubmed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await autenticarPesquisa(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });
        const q = await lerConsulta(request);
        if (!q) return Response.json({ error: "invalid_body" }, { status: 400 });
        try {
          const ingles = await consultaEmIngles(q);
          let consulta = ingles || q;
          let r = await buscarPubmed(consulta);
          if (!r.artigos.length && ingles && ingles !== q) {
            consulta = q;
            r = await buscarPubmed(q);
          }
          return Response.json({ consulta, total: r.total, resultados: r.artigos });
        } catch (err) {
          console.error("[pesquisa/pubmed]", err instanceof Error ? err.message : err);
          return Response.json({ error: "pubmed_indisponivel" }, { status: 502 });
        }
      },
    },
  },
});
