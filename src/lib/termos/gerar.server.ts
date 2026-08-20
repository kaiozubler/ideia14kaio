// IA dedicada à redação de termos de ciência (TCLE) a partir de uma instrução em
// texto livre do médico. Mesmo padrão de src/lib/questionarios/gerar.server.ts:
// chama o Lovable AI Gateway pedindo APENAS um JSON de saída, e o servidor
// normaliza/valida o resultado antes de devolver para o cliente.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

export type TermoGerado = {
  titulo: string;
  corpo: string;
  checkbox_label: string;
};

// As variáveis abaixo são as MESMAS suportadas pelo módulo de Termos em
// produção (ver TERMO_VARS em public/questionarios.js e renderCorpo() em
// src/routes/api/public/termos/assinar.ts / src/routes/t.$termoId.tsx).
// Se essa lista mudar, atualize os três lugares juntos.
const SYSTEM = `Você é um especialista jurídico na área de saúde, tecnologia e LGPD e deve montar
um termo de aceite (TCLE — Termo de Consentimento Livre e Esclarecido) de atendimentos médicos,
com base no comando abaixo.

Devolva APENAS um JSON válido no formato:
{
  "titulo": string,
  "corpo": string,
  "checkbox_label": string
}

REGRAS DE PREENCHIMENTO
- "titulo" deve ser curto e objetivo (ex.: "Termo de Consentimento — Aplicação de Toxina Botulínica").
- "corpo" é o texto completo do termo, redigido em português formal e claro, tecnicamente correto
  e juridicamente defensável à luz do Código de Ética Médica e da LGPD (Lei 13.709/2018) — inclua,
  quando pertinente ao procedimento descrito, menção a: natureza e finalidade do procedimento/tratamento,
  riscos e benefícios, alternativas existentes, direito de revogação do consentimento, e ciência sobre
  o tratamento de dados pessoais e de saúde (dado sensível, LGPD) necessário para o atendimento.
- "corpo" DEVE usar as variáveis abaixo no formato exato "{nome_da_variavel}" (com chaves), pois elas são
  substituídas automaticamente pelos dados reais na hora da assinatura. É OBRIGATÓRIO usar
  {paciente_nome}, {paciente_cpf} e {paciente_email} em algum ponto do texto (tipicamente na
  identificação/qualificação do paciente, ex.: "Eu, {paciente_nome}, portador(a) do CPF {paciente_cpf},
  ..."). Use também {medico_nome} e {data_assinatura} onde fizer sentido (ex.: "atendido(a) pelo(a)
  médico(a) {medico_nome}", "assinado eletronicamente em {data_assinatura}"). NUNCA invente outras
  variáveis além dessas cinco, e nunca deixe de incluir as três obrigatórias.
- Não use placeholders genéricos como "___________" ou "[inserir nome]" — use sempre as variáveis
  {paciente_nome}/{paciente_cpf}/{paciente_email}/{medico_nome}/{data_assinatura} no lugar.
- "checkbox_label" é a frase curta ao lado da caixa de aceite que o paciente marca antes de assinar
  (ex.: "Li e compreendi as informações acima e consinto livremente com o procedimento descrito.").
- Baseie o conteúdo estritamente no procedimento/contexto descrito na instrução do médico; não invente
  riscos ou informações clínicas específicas que não foram mencionadas — mantenha-se em linguagem
  jurídica/estrutural genérica quando o comando não detalhar tecnicamente o procedimento.
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

// Garante que as 3 variáveis obrigatórias existam no corpo, mesmo que a IA
// esqueça alguma — evita gerar um termo que não colete/exiba os dados do
// paciente corretamente.
function garantirVariaveisObrigatorias(corpo: string): string {
  let out = corpo;
  const bloco: string[] = [];
  if (!out.includes("{paciente_nome}")) bloco.push("Nome: {paciente_nome}");
  if (!out.includes("{paciente_cpf}")) bloco.push("CPF: {paciente_cpf}");
  if (!out.includes("{paciente_email}")) bloco.push("E-mail: {paciente_email}");
  if (bloco.length) {
    out = `Identificação do paciente\n${bloco.join("\n")}\n\n${out}`;
  }
  return out;
}

export async function gerarTermoIA(opts: {
  apiKey: string;
  observacao?: string | null;
}): Promise<TermoGerado> {
  const { apiKey, observacao } = opts;
  const obs = str(observacao);
  if (!obs) throw new Error("Escreva uma instrução descrevendo o termo.");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Comando do médico:\n${obs}` },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || "");

  const corpo = garantirVariaveisObrigatorias(str(parsed.corpo));

  return {
    titulo: str(parsed.titulo) || "Termo de Consentimento",
    corpo: corpo || "Eu, {paciente_nome}, portador(a) do CPF {paciente_cpf}, e-mail {paciente_email}, declaro estar ciente e de acordo com os termos deste documento.",
    checkbox_label: str(parsed.checkbox_label) || "Li e estou de acordo com os termos acima.",
  };
}
