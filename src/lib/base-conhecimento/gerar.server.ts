const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM = `Você recebe trechos de texto extraídos de documentos/anotações de um médico,
que serão usados como base de conhecimento para um chat de IA clínico.

Para cada trecho, gere de 2 a 4 perguntas curtas, em português do Brasil, que esse
trecho responde bem. Pense em como um médico perguntaria isso num chat rápido —
frequentemente com palavras diferentes das do texto original (ex.: o texto fala em
"meta pressórica" e a pergunta pode ser "até quanto pode deixar a pressão do
paciente"). O objetivo é servir de ponte de vocabulário para uma busca textual.

Se "gerar_descricao" vier true, gere também uma descrição curta (máximo 1 frase,
sem ponto final) que resuma do que se trata o conjunto de trechos — vai virar a
descrição de uma base de conhecimento.

Responda APENAS com JSON válido, sem markdown, sem comentários, no formato exato:
{"descricao_sugerida": string ou null, "itens": [{"id": string, "perguntas": string[]}]}`;

export type ChunkEntrada = { id: string; conteudo: string };
export type ItemGerado = { id: string; perguntas: string[] };

export async function gerarMetadadosChunks(params: {
  apiKey: string;
  chunks: ChunkEntrada[];
  gerarDescricao?: boolean;
}): Promise<{ descricaoSugerida: string | null; itens: ItemGerado[] }> {
  const { apiKey, chunks, gerarDescricao } = params;
  if (chunks.length === 0) return { descricaoSugerida: null, itens: [] };

  // Corta cada trecho a ~1600 caracteres (mesmo tamanho do chunk no upload) e
  // limita a 6 trechos por chamada — mantém o custo da chamada pequeno e
  // previsível, mesmo que o médico suba um documento grande de uma vez.
  const payload = chunks.slice(0, 6).map((c) => ({ id: c.id, conteudo: c.conteudo.slice(0, 1600) }));

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
        {
          role: "user",
          content: JSON.stringify({ gerar_descricao: !!gerarDescricao, trechos: payload }),
        },
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

  let parsed: { descricao_sugerida?: string | null; itens?: ItemGerado[] };
  try {
    parsed = JSON.parse(semCercas);
  } catch {
    throw new Error("Resposta da IA não veio em JSON válido");
  }

  return {
    descricaoSugerida: parsed.descricao_sugerida ?? null,
    itens: Array.isArray(parsed.itens) ? parsed.itens : [],
  };
}
