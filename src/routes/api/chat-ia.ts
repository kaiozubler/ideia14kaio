import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type RequestBody = {
  mode?: "chat" | "resumo" | "anamnese" | "copiloto";
  messages?: ChatMessage[];
  resumo_prontuario?: string;
  paciente?: Record<string, unknown>;
  atendimentos?: unknown[];
  exames?: unknown[];
  info_complementar?: Record<string, unknown> | null;
  system_prompt?: string;
  user_content?: string;
  manual?: boolean;
  primeiro_processamento?: boolean;
  trecho_transcricao?: string;
  resumo_acumulado?: string;
  transcricao_completa?: string;
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM_CHAT = `Você é um copiloto clínico para médicos durante a consulta.
Responda de forma curta, objetiva e profissional, em português do Brasil.
Use o resumo do prontuário do paciente (quando fornecido) e o histórico da conversa
para sugerir hipóteses, condutas e perguntas relevantes. Nunca invente dados do paciente
não presentes no contexto. Se faltar informação, peça ao médico.`;

const SYSTEM_RESUMO = `Você é um assistente clínico. Gere um RESUMO ESTRUTURADO do prontuário
do paciente em português do Brasil, organizado em seções:
1) DADOS BÁSICOS
2) RESUMO CONSOLIDADO DOS ÚLTIMOS ATENDIMENTOS
3) OBSERVAÇÃO DOS EXAMES
4) DADOS CLÍNICOS RELEVANTES
Seja conciso, factual, sem invenções. Use bullets curtos. Não inclua disclaimers.`;

const SYSTEM_COPILOTO = `Objetivo

Você atua como um assistente clínico de apoio à consulta médica.
Sua função auxiliar o profissional médico, NÃO substituir o julgamento médico.
Sua função é:
- Consolidar as informações disponíveis sobre o paciente.
- Identificar informações relevantes para investigação diagnóstica.
- Sugerir perguntas que possam confirmar ou descartar hipóteses diagnósticas.
- Destacar sinais de alerta ou pontos de atenção.
- Sugerir possíveis condutas apenas quando houver evidências suficientes nos dados recebidos.

Dados Recebidos
Você receberá: resumo acumulado da consulta, resumo do prontuário, memória clínica do paciente e trecho recente da transcrição. Considere tudo em conjunto.

Regras Gerais
- Nunca invente informações. Nunca complete lacunas com suposições.
- Nunca crie sintomas, antecedentes, exames ou diagnósticos não informados.
- Nunca considere como fato algo que não esteja explicitamente presente nos dados recebidos.
- Nunca afirme certeza diagnóstica quando os dados forem insuficientes.
- Não interprete silêncio ou ausência de informação como evidência clínica.
- Não gere perguntas já realizadas ou claramente respondidas anteriormente.
- Não gere sugestões redundantes.
- Não gere orientações que possam induzir a erro, negligência ou prática ilegal.
- Priorize segurança do paciente.

Memória Clínica
Sempre que identificar informações clinicamente relevantes, registre-as na memória estruturada do paciente (histórico pessoal, histórico familiar, alergias, medicamentos em uso, hábitos e fatores de risco). Registre apenas o que for explicitamente mencionado.

Resumo Clínico
Gere um resumo consolidado da consulta contendo: queixa principal, história da doença atual, antecedentes relevantes e pontos de atenção. Não inclua interpretações não sustentadas pelos dados.

Perguntas de Investigação
Gere perguntas somente quando: existir hipótese plausível ainda não esclarecida; a resposta puder alterar significativamente a investigação; a informação ainda não estiver disponível. As perguntas devem ser objetivas, clinicamente relevantes e ajudar a confirmar/descartar hipóteses. Se não houver perguntas relevantes, retorne lista vazia.

Hipóteses Diagnósticas
Somente apresente hipóteses quando houver evidências razoáveis nos dados. Para cada hipótese informe grau de confiança (Baixo/Moderado/Alto), evidências e informações ainda ausentes. Se faltarem dados, retorne lista vazia.

Sugestões de Conduta
Somente sugira condutas quando existir base clínica suficiente (investigação adicional, exames, monitoramento, encaminhamento, suporte/orientação). Nunca apresente como obrigatória — descreva como possibilidade a ser avaliada pelo médico. Se não houver segurança suficiente, não gere conduta.

Formato de Resposta
Retorne EXCLUSIVAMENTE um JSON válido (sem comentários, sem markdown, sem cercas) no formato:
{
  "resumo_clinico": "",
  "memoria_clinica": {
    "historico_pessoal": [],
    "historico_familiar": [],
    "alergias": [],
    "medicamentos_em_uso": [],
    "fatores_risco": []
  },
  "pontos_atencao": [],
  "perguntas_sugeridas": [],
  "hipoteses_diagnosticas": [],
  "condutas_sugeridas": []
}`;

Quando o usuário pedir para criar um documento médico (receita, orientações, atestado), responda em JSON com este formato EXATO — sem texto fora do JSON:

{
  "reply": "mensagem para exibir no chat",
  "action": {
    "type": "tipo_da_acao",
    ...campos específicos...
  }
}

Tipos de ação disponíveis:

1. Receita:
{
  "type": "open_receita",
  "medicamentos": [
    {
      "nome": "Nome comercial ou princípio ativo",
      "apresentacao": "Ex: 500mg comprimido",
      "quantidade": "Ex: 1 caixa",
      "posologia": "Ex: 1 comprimido de 8/8h por 5 dias"
    }
  ]
}

2. Orientações ao paciente (não precisa de assinatura):
{
  "type": "send_orientacoes",
  "texto": "Texto completo das orientações"
}

3. Abrir fluxo de conduta completo:
{
  "type": "open_conduta",
  "sugestao": "descrição da conduta sugerida"
}

Se a mensagem não for um pedido de documento, responda normalmente em texto puro (sem JSON).

async function callGateway(messages: ChatMessage[], apiKey: string) {
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
    throw new Response(`AI gateway error ${res.status}: ${text}`, { status: res.status });
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export const Route = createFileRoute("/api/chat-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }
        let body: RequestBody;
        try {
          body = (await request.json()) as RequestBody;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const mode = body.mode ?? "chat";

        try {
          if (mode === "resumo") {
            const ctx = JSON.stringify(
              {
                paciente: body.paciente ?? null,
                info_complementar: body.info_complementar ?? null,
                atendimentos: body.atendimentos ?? [],
                exames: body.exames ?? [],
              },
              null,
              2,
            );
            const text = await callGateway(
              [
                { role: "system", content: SYSTEM_RESUMO },
                {
                  role: "user",
                  content:
                    "Contexto do paciente em JSON (use só o que estiver presente):\n\n" + ctx,
                },
              ],
              apiKey,
            );
            return Response.json({ resumo: text });
          }

          if (mode === "anamnese") {
            const sys = (body.system_prompt || "").trim();
            const usr = (body.user_content || "").trim();
            if (!sys || !usr) {
              return new Response("Missing system_prompt or user_content", { status: 400 });
            }
            const text = await callGateway(
              [
                { role: "system", content: sys },
                { role: "user", content: usr },
              ],
              apiKey,
            );
            return Response.json({ reply: text });
          }

          if (mode === "copiloto") {
            const ctx: Record<string, unknown> = {
              primeiro_processamento: !!body.primeiro_processamento,
              manual: !!body.manual,
              resumo_acumulado: body.resumo_acumulado ?? "",
              trecho_transcricao: body.trecho_transcricao ?? "",
            };
            if (body.primeiro_processamento) {
              ctx.paciente = body.paciente ?? null;
              ctx.resumo_prontuario = body.resumo_prontuario ?? "";
              ctx.info_complementar = body.info_complementar ?? null;
              ctx.transcricao_completa = body.transcricao_completa ?? "";
            }
            const text = await callGateway(
              [
                { role: "system", content: SYSTEM_COPILOTO },
                {
                  role: "user",
                  content:
                    "Dados da consulta em JSON (use apenas o que estiver presente):\n\n" +
                    JSON.stringify(ctx, null, 2),
                },
              ],
              apiKey,
            );
            // tenta extrair JSON da resposta (modelo pode envolver em ```json)
            let parsed: Record<string, unknown> = {};
            try {
              const cleaned = text
                .trim()
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/```\s*$/i, "");
              parsed = JSON.parse(cleaned);
            } catch {
              const m = text.match(/\{[\s\S]*\}/);
              if (m) {
                try {
                  parsed = JSON.parse(m[0]);
                } catch {
                  parsed = { raw: text };
                }
              } else {
                parsed = { raw: text };
              }
            }
            return Response.json(parsed);
          }

          // chat mode
          const history = Array.isArray(body.messages) ? body.messages : [];
          const resumo = (body.resumo_prontuario || "").trim();
          const systemContent =
            SYSTEM_CHAT +
            (resumo
              ? "\n\n=== RESUMO DO PRONTUÁRIO DO PACIENTE ===\n" + resumo
              : "\n\n(Sem resumo de prontuário disponível.)");
          const messages: ChatMessage[] = [
            { role: "system", content: systemContent },
            ...history.filter(
              (m) =>
                m &&
                (m.role === "user" || m.role === "assistant") &&
                typeof m.content === "string",
            ),
          ];
          const text = await callGateway(messages, apiKey);
          return Response.json({ reply: text });
        } catch (err) {
          if (err instanceof Response) return err;
          const msg = err instanceof Error ? err.message : "Unknown error";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});