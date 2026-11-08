import { chamarIA } from "@/lib/ia/provedor.server";

// PubMed, Cochrane, Europe PMC e ClinicalTrials.gov indexam em inglês e não
// traduzem consultas em português ("enxaqueca crônica" não acha nada). Um
// modelo rápido converte a consulta uma vez; as fontes buscadas ao mesmo tempo
// na mesma instância reaproveitam a mesma promessa. Se a IA falhar ou demorar,
// as fontes buscam com o texto original.
const cache = new Map<string, { em: number; p: Promise<string | null> }>();
const VALIDADE_MS = 10 * 60 * 1000;

export function consultaEmIngles(q: string): Promise<string | null> {
  const chave = q.trim().toLowerCase();
  const agora = Date.now();
  const atual = cache.get(chave);
  if (atual && agora - atual.em < VALIDADE_MS) return atual.p;
  if (cache.size > 500) cache.clear();
  const p = traduzir(q);
  cache.set(chave, { em: agora, p });
  // Uma falha não fica guardada: a próxima busca tenta de novo.
  p.then((v) => {
    if (v === null) cache.delete(chave);
  });
  return p;
}

async function traduzir(q: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  const traducao = chamarIA(
    "gemini",
    [
      {
        role: "system",
        content:
          "Converta a pesquisa do médico em uma consulta de busca em bases científicas (PubMed), em inglês, usando" +
          " termos MeSH quando houver e operadores AND/OR quando ajudarem. Responda somente com a consulta, em uma" +
          " linha, sem aspas nem explicação.",
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
      console.warn(
        "[pesquisa] tradução da consulta falhou:",
        err instanceof Error ? err.message : err,
      );
      return null;
    });
  const limite = new Promise<null>((r) => setTimeout(() => r(null), 6000));
  return Promise.race([traducao, limite]);
}
