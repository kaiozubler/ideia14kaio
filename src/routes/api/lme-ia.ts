import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Body = {
  action?: "autofill" | "chat";
  /** Estado atual do formulário LME espelhado no app. */
  form?: Record<string, unknown>;
  /** Contexto do paciente/prontuário para extração. */
  contexto?: Record<string, unknown>;
  messages?: ChatMessage[];
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const CAMPOS = `Campos do LME (chaves exatas do JSON):
cnes (número CNES do estabelecimento), estabelecimento (nome do estabelecimento de saúde solicitante),
paciente_nome, paciente_mae, peso (kg, número), altura (cm, número),
medicamentos: lista de { nome, quantidades: [q1,q2,q3,q4,q5,q6] } (quantidade solicitada por mês, strings),
cid_code, cid_descricao, diagnostico, anamnese,
tratamento_previo ("nao" | "sim"), tratamento_previo_relato,
incapaz ("nao" | "sim"), responsavel_nome,
medico_nome, medico_cns, data_solicitacao (AAAA-MM-DD),
preenchido_por ("paciente" | "mae" | "responsavel" | "medico" | "outro"), outro_nome, outro_cpf,
raca ("branca" | "preta" | "parda" | "amarela" | "indigena"), etnia,
telefone, documento_numero, documento_tipo ("cpf" | "cns"), email.`;

const SYSTEM_AUTOFILL = `Você preenche o formulário LME (Laudo para Solicitação, Avaliação e Autorização de
Medicamentos do Componente Especializado da Assistência Farmacêutica — SUS) a partir dos dados já
existentes no sistema do médico.

${CAMPOS}

REGRAS CRÍTICAS:
- Use SOMENTE informações explicitamente presentes no contexto recebido. NUNCA invente dados
  (nome, CNES, CNS, peso, altura, CID, medicamentos, telefone, documento).
- Deixe o campo como string vazia (ou lista vazia) quando a informação não existir no contexto.
- "anamnese": redija um texto clínico objetivo (5 a 12 linhas) baseado apenas no prontuário, resumo,
  exames e dados clínicos fornecidos, no formato exigido pelo laudo (história da doença, evolução,
  tratamentos realizados, justificativa da solicitação).
- "diagnostico": descrição do diagnóstico correspondente ao CID informado no contexto.
- "tratamento_previo": use "sim" apenas quando o contexto indicar tratamento anterior/atual da doença,
  e descreva em "tratamento_previo_relato".
- Não use markdown. Responda EXCLUSIVAMENTE com um JSON válido contendo as chaves acima e mais
  "pendencias": lista curta de textos com os campos obrigatórios que ficaram sem dado no contexto.`;

const SYSTEM_CHAT = `Você é a assistente do preenchimento do formulário LME (medicamentos de alto custo do SUS).
Você conversa com o MÉDICO em português do Brasil para completar os campos que faltam.

${CAMPOS}

Como agir:
- Receberá o estado atual do formulário e o contexto do paciente. Identifique os campos obrigatórios ainda
  vazios (cnes, estabelecimento, paciente_nome, paciente_mae, peso, altura, medicamentos, cid_code,
  anamnese, tratamento_previo, incapaz, medico_nome, medico_cns, data_solicitacao, preenchido_por, raca)
  e pergunte por eles, um ou dois por mensagem, de forma curta e direta.
- Extraia do texto livre do médico os valores dos campos e devolva em "patch" apenas os campos que
  mudaram. Nunca preencha um campo com suposição.
- Quando não faltar nada obrigatório, informe que o laudo está pronto para emissão.

Responda EXCLUSIVAMENTE com JSON válido, sem markdown:
{ "reply": "mensagem curta para o médico", "patch": { ...apenas campos alterados... }, "pendencias": ["..."] }`;

function parseJsonLoose(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
    return { reply: text };
  }
}

async function callGateway(messages: ChatMessage[], apiKey: string): Promise<string> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export const Route = createFileRoute("/api/lme-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const action = body.action ?? "autofill";
        const ctx = JSON.stringify(body.contexto ?? {}, null, 2);
        const form = JSON.stringify(body.form ?? {}, null, 2);

        try {
          if (action === "chat") {
            const history = (body.messages ?? []).slice(-14);
            const text = await callGateway(
              [
                { role: "system", content: SYSTEM_CHAT },
                {
                  role: "user",
                  content:
                    "ESTADO ATUAL DO FORMULÁRIO (JSON):\n" +
                    form +
                    "\n\nCONTEXTO DO PACIENTE (JSON):\n" +
                    ctx,
                },
                ...history,
              ],
              apiKey,
            );
            const parsed = parseJsonLoose(text);
            return Response.json({
              reply: typeof parsed.reply === "string" ? parsed.reply : text,
              patch: (parsed.patch as Record<string, unknown>) ?? {},
              pendencias: Array.isArray(parsed.pendencias) ? parsed.pendencias : [],
            });
          }

          const text = await callGateway(
            [
              { role: "system", content: SYSTEM_AUTOFILL },
              {
                role: "user",
                content:
                  "CONTEXTO DISPONÍVEL (JSON — use só o que estiver presente):\n" +
                  ctx +
                  "\n\nCAMPOS JÁ PREENCHIDOS PELO MÉDICO (não sobrescreva com valor pior):\n" +
                  form,
              },
            ],
            apiKey,
          );
          const parsed = parseJsonLoose(text);
          return Response.json({
            form: parsed,
            pendencias: Array.isArray(parsed.pendencias) ? parsed.pendencias : [],
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Falha na IA do LME";
          return new Response(msg, { status: 502 });
        }
      },
    },
  },
});
