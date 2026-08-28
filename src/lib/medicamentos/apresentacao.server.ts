// Simplificação dos textos de APRESENTAÇÃO da Anvisa via Lovable AI Gateway.
//
// O texto original da Anvisa (ex.: "(0,015 + 0,06) MG COM REV CT BL AL PLAS
// PVC/ACLAR TRANS CALEND X 28 (24 + 4)") é ilegível na prescrição. A IA apenas
// REESCREVE esse texto (traduz abreviações e organiza), sem alterar dose,
// concentração, unidade ou quantidade, e sugere uma posologia padrão genérica
// coerente apenas com a forma farmacêutica.
//
// O resultado é cacheado em public.apresentacao_legivel (chave = texto original)
// e propagado para public.medicamentos (apresentacao_simplificada / posologia_padrao),
// então cada apresentação distinta custa uma única passagem de IA.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

export const SYSTEM_APRESENTACAO = `Você recebe textos de APRESENTAÇÃO de medicamentos exatamente como constam no cadastro da Anvisa,
cheios de abreviações de embalagem (CT, BL, AL, PLAS, PVC, FA, VD, AMB, TRANS, OPC, etc.).

Sua tarefa: reescrever cada texto de forma curta e legível para um médico prescrever, SEM alterar
nenhum valor, dose, concentração, unidade ou quantidade. Não busque nada externo, não invente nada:
apenas traduza as abreviações e organize o que já está no texto.

Formato do texto simplificado: "<concentração> — <forma farmacêutica>, <embalagem/quantidade>"
Exemplos:
- "50 MG COM REV CT BL AL PVC/PE/PVDC BCO OPC X 15" -> "50 mg — comprimido revestido, caixa com 15"
- "(50+ 12,5) MG COM REV CT BL AL PLAS OPC X 30" -> "50 + 12,5 mg — comprimido revestido, caixa com 30"
- "25 U SUS INJ IM CT 1 FA VD INC X 0,5 ML" -> "25 U/0,5 mL — suspensão injetável intramuscular, 1 frasco-ampola"
- "10 MG/ML SOL OR CT FR PLAS GOT X 20 ML" -> "10 mg/mL — solução oral em gotas, frasco de 20 mL"
Omita detalhes irrelevantes de material da embalagem (alumínio, PVC, âmbar, opaco).

Devolva também uma "posologia" padrão genérica, coerente APENAS com a forma farmacêutica
(não invente dose terapêutica, frequência clínica específica nem indicação). Exemplos:
- comprimido/cápsula: "1 comprimido por via oral, conforme orientação médica"
- gotas: "conforme orientação médica, por via oral (gotas)"
- injetável: "aplicar conforme orientação médica, por via intramuscular"
- creme/pomada: "aplicar na área afetada, conforme orientação médica"

Responda APENAS com JSON válido, sem markdown:
{"itens":[{"i":<índice recebido>,"texto":"<simplificado>","posologia":"<posologia padrão>"}]}`;

export type ApresentacaoLegivel = {
  apresentacao: string;
  texto_simplificado: string;
  posologia_padrao: string | null;
};

/** Traduz um lote pequeno (recomendado: até 8 itens) de apresentações. */
export async function simplificarLote(params: {
  apiKey: string;
  apresentacoes: string[];
}): Promise<ApresentacaoLegivel[]> {
  const { apiKey, apresentacoes } = params;
  if (apresentacoes.length === 0) return [];

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
        { role: "system", content: SYSTEM_APRESENTACAO },
        {
          role: "user",
          content: JSON.stringify({
            apresentacoes: apresentacoes.map((apresentacao, i) => ({ i, apresentacao })),
          }),
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI gateway error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = (data.choices?.[0]?.message?.content ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: { itens?: { i?: number; texto?: string; posologia?: string }[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Resposta da IA não veio em JSON válido");
  }

  const out: ApresentacaoLegivel[] = [];
  for (const item of parsed.itens ?? []) {
    const original = typeof item.i === "number" ? apresentacoes[item.i] : undefined;
    const texto = (item.texto ?? "").trim();
    if (!original || !texto) continue;
    out.push({
      apresentacao: original,
      texto_simplificado: texto,
      posologia_padrao: (item.posologia ?? "").trim() || null,
    });
  }
  return out;
}
