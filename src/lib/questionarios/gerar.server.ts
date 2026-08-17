// IA dedicada à estruturação de questionários/formulários para pacientes a partir de
// uma instrução em texto livre do médico.
//
// Segue o mesmo padrão de src/lib/protocolos/gerar.server.ts: chama o Lovable AI
// Gateway pedindo APENAS um JSON de saída, e o servidor normaliza/valida o
// resultado antes de devolver para o cliente (a IA nunca é confiável o suficiente
// para popular o banco direto).

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

export type PerguntaIA = {
  temp_id: string;
  tipo: "texto" | "unica" | "multipla" | "escala";
  enunciado: string;
  longa: boolean; // só relevante quando tipo = "texto"
  opcoes: string[]; // só relevante quando tipo = "unica" | "multipla"
  escala_min: number | null; // só relevante quando tipo = "escala"
  escala_max: number | null;
  escala_label_min: string;
  escala_label_max: string;
  obrigatoria: boolean;
};

export type QuestionarioGerado = {
  titulo: string;
  descricao: string;
  anonimo: boolean;
  perguntas: PerguntaIA[];
};

const SYSTEM = `Você é um assistente clínico que estrutura formulários/questionários para pacientes
responderem (ex: anamnese, avaliação pós-consulta, triagem de sintomas, satisfação).

A partir da instrução recebida, devolva APENAS um JSON válido no formato:
{
  "titulo": string,
  "descricao": string,
  "anonimo": boolean,
  "perguntas": [
    {
      "temp_id": string,
      "tipo": "texto" | "unica" | "multipla" | "escala",
      "enunciado": string,
      "longa": boolean,
      "opcoes": string[],
      "escala_min": number | null,
      "escala_max": number | null,
      "escala_label_min": string,
      "escala_label_max": string,
      "obrigatoria": boolean
    }
  ]
}

REGRAS DE PREENCHIMENTO
- "tipo" = "texto": resposta livre. "longa" = true quando espera-se um relato mais extenso
  (ex.: histórico, queixa), false para uma resposta curta (ex.: nome de um sintoma).
- "tipo" = "unica": o paciente escolhe UMA opção entre "opcoes" (mínimo 2). Use quando as
  alternativas são mutuamente exclusivas (ex.: "Sim/Não/Não sei").
- "tipo" = "multipla": o paciente pode marcar VÁRIAS opções entre "opcoes" (mínimo 2).
- "tipo" = "escala": resposta numérica em uma faixa (ex.: nível de dor 0 a 10, satisfação 1 a 5).
  Preencha escala_min/escala_max com a faixa mais adequada ao que está sendo perguntado (o padrão
  mais comum é 0 a 10 para intensidade/dor e 1 a 5 para satisfação/concordância). escala_label_min
  e escala_label_max são rótulos curtos opcionais para as pontas da escala (ex.: "Sem dor" /
  "Pior dor possível"); deixe como string vazia quando não fizer sentido.
- Para tipos que não usam um campo, ainda assim inclua o campo no JSON com um valor neutro:
  "opcoes": [] quando não for unica/multipla, "escala_min"/"escala_max": null quando não for escala.
- "obrigatoria" deve ser true na maioria dos casos, a não ser que a instrução diga o contrário ou a
  pergunta seja claramente opcional/complementar.
- "anonimo": true somente se a instrução pedir explicitamente um formulário anônimo/sem identificação;
  caso contrário, false (formulário nominal, com nome/telefone/e-mail/CPF do paciente).
- Quebre a instrução em perguntas objetivas e específicas — nunca junte duas perguntas em um único
  enunciado. Não invente perguntas fora do escopo pedido.
- "titulo" deve ser curto (poucas palavras) e "descricao" uma frase explicando o propósito do
  formulário para o paciente.
- Nunca inclua texto fora do JSON.`;

function parseJsonLoose(text: string): Record<string, any> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

const TIPOS_PERGUNTA = ["texto", "unica", "multipla", "escala"] as const;
function normTipo(v: unknown): PerguntaIA["tipo"] {
  const t = str(v).toLowerCase();
  const hit = TIPOS_PERGUNTA.find((x) => x === t);
  return hit || "texto";
}

export async function gerarQuestionarioIA(opts: {
  apiKey: string;
  observacao?: string | null;
}): Promise<QuestionarioGerado> {
  const { apiKey, observacao } = opts;
  const obs = str(observacao);
  if (!obs) throw new Error("Escreva uma instrução descrevendo o formulário.");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Instruções do médico:\n${obs}` },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || "");

  const perguntasBrutas = Array.isArray(parsed.perguntas) ? parsed.perguntas : [];
  const perguntas: PerguntaIA[] = perguntasBrutas
    .map((x: any) => {
      const tipo = normTipo(x?.tipo);
      const opcoesBrutas = Array.isArray(x?.opcoes) ? x.opcoes.map((o: unknown) => str(o)).filter(Boolean) : [];
      return {
        temp_id: str(x?.temp_id) || Math.random().toString(36).slice(2, 9),
        tipo,
        enunciado: str(x?.enunciado),
        longa: tipo === "texto" ? !!x?.longa : false,
        opcoes: tipo === "unica" || tipo === "multipla" ? (opcoesBrutas.length >= 2 ? opcoesBrutas : [...opcoesBrutas, "", ""].slice(0, Math.max(2, opcoesBrutas.length))) : [],
        escala_min: tipo === "escala" ? (Number.isFinite(+x?.escala_min) ? +x.escala_min : 1) : null,
        escala_max: tipo === "escala" ? (Number.isFinite(+x?.escala_max) ? +x.escala_max : 5) : null,
        escala_label_min: str(x?.escala_label_min),
        escala_label_max: str(x?.escala_label_max),
        obrigatoria: x?.obrigatoria !== false,
      };
    })
    .filter((p: PerguntaIA) => !!p.enunciado);

  return {
    titulo: str(parsed.titulo) || "Formulário sem título",
    descricao: str(parsed.descricao),
    anonimo: !!parsed.anonimo,
    perguntas,
  };
}
