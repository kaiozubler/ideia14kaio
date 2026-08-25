const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM = `Você recebe trechos de texto extraídos de documentos/anotações de um médico,
que serão usados como base de conhecimento para um chat de IA clínico.

Gere uma descrição curta (máximo 1 frase, sem ponto final) que resuma do que se
trata o conjunto de trechos — vai virar a descrição de uma base de conhecimento,
exibida ao médico e usada pela IA para decidir quando essa base é relevante.

Responda APENAS com JSON válido, sem markdown, sem comentários, no formato exato:
{"descricao_sugerida": string ou null}`;

export type ChunkEntrada = { id: string; conteudo: string };

// Nota: este módulo já gerou também de 2 a 4 "perguntas relacionadas" por
// chunk (coluna base_conhecimento_itens.perguntas_relacionadas), pensadas
// como ponte de vocabulário para a busca textual. A função de busca
// (buscar_base_conhecimento) foi reescrita depois para usar apenas
// similaridade de texto sobre `conteudo` e nunca passou a usar as perguntas
// geradas — elas eram gravadas mas nunca lidas em lugar nenhum (nem na busca,
// nem na UI). Como não havia ganho real, a geração foi removida em vez de
// mantida "por via das dúvidas": ela custava uma chamada de IA por lote de 6
// chunks a cada upload de documento, sem nenhum efeito observável no produto.
export async function gerarDescricaoBase(params: {
  apiKey: string;
  chunks: ChunkEntrada[];
}): Promise<{ descricaoSugerida: string | null }> {
  const { apiKey, chunks } = params;
  if (chunks.length === 0) return { descricaoSugerida: null };

  // Usa só os primeiros trechos (uma amostra já basta pra resumir do que se
  // trata o documento) — mantém a chamada pequena e previsível.
  const payload = chunks
    .slice(0, 6)
    .map((c) => ({ id: c.id, conteudo: c.conteudo.slice(0, 1600) }));

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify({ trechos: payload }) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = (data.choices?.[0]?.message?.content ?? "").trim();
  const semCercas = raw.replace(/^```json\s*|```$/g, "").trim();

  let parsed: { descricao_sugerida?: string | null };
  try {
    parsed = JSON.parse(semCercas);
  } catch {
    throw new Error("Resposta da IA não veio em JSON válido");
  }

  return { descricaoSugerida: parsed.descricao_sugerida ?? null };
}
