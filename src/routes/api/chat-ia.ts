import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type RequestBody = {
  mode?: "chat" | "resumo" | "anamnese" | "copiloto" | "extrair_complementares";
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
  info_complementar_atual?: Record<string, unknown> | null;
  cids_atuais?: { code?: string; description?: string }[];
  cid_opcoes?: { c?: string; d?: string }[];
  conteudo_atendimento?: string;
};

const IC_FIELD_META: Record<string, { label: string; tipo: "texto" | "numero" | "select"; opcoes?: string[] }> = {
  peso: { label: "Peso (kg)", tipo: "numero" },
  altura: { label: "Altura (cm)", tipo: "numero" },
  sangue: { label: "Tipo sanguíneo", tipo: "select", opcoes: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
  sedent: {
    label: "Sedentarismo",
    tipo: "select",
    opcoes: ["Sedentário", "Atividade leve (1-2x/sem)", "Atividade moderada (3-4x/sem)", "Atividade intensa (5+x/sem)"],
  },
  tab: { label: "Tabagismo", tipo: "select", opcoes: ["Nunca fumou", "Ex-tabagista", "Tabagista ativo"] },
  eti: {
    label: "Etilismo",
    tipo: "select",
    opcoes: ["Não consome", "Social / ocasional", "Frequente", "Etilista crônico"],
  },
  sono: {
    label: "Sono",
    tipo: "select",
    opcoes: [
      "Bom / reparador",
      "Regular",
      "Insônia ocasional",
      "Insônia frequente",
      "Sonolência diurna excessiva",
      "Suspeita de apneia do sono",
    ],
  },
  meds: { label: "Medicamentos em uso", tipo: "texto" },
  alerg: { label: "Alergias", tipo: "texto" },
  fam: { label: "Antecedentes familiares", tipo: "texto" },
  outros: { label: "Outras observações relevantes", tipo: "texto" },
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM_CHAT = `Você é um copiloto clínico para médicos durante a consulta.
Responda de forma curta, objetiva e profissional, em português do Brasil.
Use o resumo do prontuário do paciente (quando fornecido) e o histórico da conversa
para sugerir hipóteses, condutas e perguntas relevantes. Nunca invente dados do paciente
não presentes no contexto. Se faltar informação, peça ao médico.

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

Se a mensagem não for um pedido de documento, responda normalmente em texto puro (sem JSON).`;

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
const SYSTEM_EXTRAI_COMPLEMENTARES = `Você é um assistente clínico responsável por revisar o conteúdo de UM
atendimento (anotações do prontuário, transcrição, anamnese e notas do médico) e identificar
informações objetivas que deveriam atualizar o cadastro "Informações complementares" do paciente.

REGRAS CRÍTICAS (siga rigorosamente):
- Só proponha uma alteração quando a informação for EXPLÍCITA, CLARA e POSITIVA no conteúdo do
  atendimento (algo que o médico ou o paciente efetivamente afirmou). NUNCA infira, deduza,
  presuma ou complete lacunas.
- Nunca proponha uma alteração para um campo cujo valor atual já reflete a mesma informação.
- Cada campo tem metadados em "campos" (label, tipo e, quando for "select", a lista exata de
  "opcoes"). Para campos do tipo "select", o "valor_sugerido" deve ser EXATAMENTE IGUAL a uma das
  opções da lista. Se a informação do atendimento não corresponder claramente a nenhuma opção, não
  proponha nada para aquele campo.
- Para campos de texto livre ("texto"), o "valor_sugerido" deve ser o TEXTO FINAL completo do
  campo: preserve todo o conteúdo já existente em "info_complementar_atual" e apenas acrescente a
  informação nova e explícita, sem duplicar o que já existe e sem reescrever o que já estava
  correto.
- Para campos numéricos ("numero"), só proponha se houver um valor numérico explícito mencionado.
- Para CIDs, só sugira itens presentes na lista "cid_opcoes" fornecida (use o mesmo "code" e
  "description" da lista), e apenas quando o atendimento indicar claramente um
  diagnóstico/condição correspondente. Nunca repita um código já presente em "cids_atuais".
- Se nada disso se aplicar a nenhum campo, retorne listas vazias. Não force sugestões apenas para
  preencher a resposta.

Retorne EXCLUSIVAMENTE um JSON válido (sem comentários, sem markdown, sem cercas de código) no
formato exato:
{
  "alteracoes": [ { "campo": "nome_do_campo_conforme_recebido", "valor_sugerido": "..." } ],
  "cids_sugeridos": [ { "code": "...", "description": "..." } ]
}`;

function parseJsonLoose(text: string): Record<string, unknown> {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");
    return JSON.parse(cleaned);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return { raw: text };
      }
    }
    return { raw: text };
  }
}

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
                  content: "Contexto do paciente em JSON (use só o que estiver presente):\n\n" + ctx,
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
                    "Dados da consulta em JSON (use apenas o que estiver presente):\n\n" + JSON.stringify(ctx, null, 2),
                },
              ],
              apiKey,
            );
            // tenta extrair JSON da resposta (modelo pode envolver em ```json)
            return Response.json(parseJsonLoose(text));
          }

          if (mode === "extrair_complementares") {
            const conteudo = (body.conteudo_atendimento || "").trim();
            if (!conteudo) {
              return Response.json({ alteracoes: [], cids_sugeridos: [] });
            }
            const ctx = JSON.stringify(
              {
                campos: IC_FIELD_META,
                info_complementar_atual: body.info_complementar_atual ?? {},
                cids_atuais: body.cids_atuais ?? [],
                cid_opcoes: body.cid_opcoes ?? [],
                conteudo_atendimento: conteudo,
              },
              null,
              2,
            );
            const text = await callGateway(
              [
                { role: "system", content: SYSTEM_EXTRAI_COMPLEMENTARES },
                { role: "user", content: "Dados em JSON:\n\n" + ctx },
              ],
              apiKey,
            );
            const parsed = parseJsonLoose(text);
            const alteracoes = Array.isArray(parsed.alteracoes) ? parsed.alteracoes : [];
            const cidsSugeridos = Array.isArray(parsed.cids_sugeridos) ? parsed.cids_sugeridos : [];
            return Response.json({ alteracoes, cids_sugeridos: cidsSugeridos });
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
              (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
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
