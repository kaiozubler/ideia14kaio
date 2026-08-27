import { createFileRoute } from "@tanstack/react-router";
import { analisarExameArquivo, type AnaliseExame } from "@/lib/exames/analise.server";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type RequestBody = {
  mode?: "chat" | "resumo" | "anamnese" | "copiloto" | "extrair_complementares";
  messages?: ChatMessage[];
  resumo_prontuario?: string;
  // Respostas de questionários que o paciente preencheu (enviados pela tela de
  // Questionário), já formatadas em texto pelo cliente — um bloco por formulário
  // respondido, cada um com título e data de resposta. Pode haver mais de um
  // formulário e mais de uma resposta para o mesmo formulário.
  questionarios_paciente?: string;
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
  // Agendamento(s) reais já criados nesta mesma consulta (pode haver mais de
  // um) — não depende da IA, vem direto do momento em que o médico de fato
  // marcou o(s) retorno(s) pelo modal/comando de voz. Quando presente, a IA
  // não deve propor um novo.
  agendamentos_ja_realizados?: { data?: string; horario?: string; motivo?: string }[];
  // Anexo enviado pelo médico no chat da consulta (ex.: PDF de exame).
  anexo?: { nome?: string; mime?: string; base64?: string } | null;
  paciente_cpf?: string | null;
  paciente_nome?: string | null;
  paciente_nascimento?: string | null;
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

Quando o usuário pedir para criar um documento médico (receita, orientações, atestado, solicitação de exames), responda em JSON com este formato EXATO — sem texto fora do JSON:

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

4. Agendar retorno/consulta futura para o paciente (uso rápido, durante a própria consulta):
{
  "type": "open_agendamento",
  "data": "AAAA-MM-DD ou vazio se o médico não especificou",
  "horario": "HH:MM ou vazio se o médico não especificou",
  "motivo": "Ex: Retorno para reavaliação",
  "prazo_sugerido": "texto curto tipo '7 dias', '1 mês', '30 dias' — preencha quando o médico falar em prazo relativo em vez de data exata"
}
Use "open_agendamento" sempre que o médico pedir explicitamente para agendar, marcar retorno ou remarcar
o paciente durante a conversa. Como isso acontece em meio à consulta, o processo deve ser o mais rápido
possível: NÃO peça confirmação por texto antes de gerar a ação — apenas gere o JSON com os dados que o
médico informou (mesmo que incompletos); a confirmação final acontece na interface, não no chat.

5. Solicitação de exames:
{
  "type": "open_solicitacao_exame",
  "exames": [
    { "nome": "Nome do exame (ex: Hemograma completo)", "instrucoes": "Observação específica deste exame, opcional" }
  ],
  "carater": "eletivo ou urgente — padrão eletivo, só use urgente se o médico disser isso explicitamente",
  "jejum": true ou false,
  "indicacao_clinica": "motivo clínico da solicitação, opcional",
  "cid": "código CID, opcional",
  "preparo": "orientações de preparo ao paciente, opcional",
  "observacoes": "observações gerais, opcional"
}
IMPORTANTE: NUNCA inclua exames odontológicos (radiografia dentária, avaliação odontológica, profilaxia,
canal, etc.) em "exames" — esse tipo de exame não é coberto por este sistema e não deve ser sugerido em
nenhuma hipótese, mesmo que o médico peça. Nesse caso, responda em texto normal explicando que não está
disponível aqui.

6. Salvar no cadastro do paciente um exame que já foi analisado pela IA de exames:
{
  "type": "salvar_exame",
  "nome": "Nome/título do exame",
  "tipo": "Laboratorial | Imagem | Laudo | Documento | Outro",
  "data": "AAAA-MM-DD",
  "obs": "observação curta",
  "resultado": "resultado/resumo consolidado"
}

7. Gerar a anamnese da consulta:
{
  "type": "open_anamnese"
}
Use "open_anamnese" sempre que o médico pedir para criar/gerar a anamnese (ex.: "gera a anamnese",
"faz a anamnese desse paciente"). NUNCA pergunte no chat qual modelo/prompt de anamnese usar e NUNCA
tente escrever a anamnese você mesmo neste modo — a interface do sistema já consulta os modelos de
anamnese cadastrados pelo médico e, se houver mais de um, mostra a lista para ele escolher qual prompt
usar antes de gerar o texto. Sua resposta ("reply") deve só confirmar que vai abrir a geração da anamnese.

EXAMES ANEXADOS
Quando a conversa trouxer o bloco "ANÁLISE DE EXAME (IA de exames)", o arquivo enviado pelo médico já foi
analisado pela IA dedicada de exames — use exclusivamente aquele conteúdo, sem inventar valores.
Nesse caso responda informando o nome e o CPF do paciente detectados no documento (ou avise que o documento
não traz esses dados), a data do exame, os exames identificados e os pontos de atenção. Se o exame for do
paciente desta consulta, pergunte se o médico deseja salvar o exame no cadastro dele; só gere a ação
"salvar_exame" depois da confirmação. Se os dados do documento indicarem outra pessoa, alerte a divergência
e não proponha o salvamento.

MÚLTIPLAS AÇÕES NA MESMA MENSAGEM
Se o médico pedir mais de uma coisa na mesma mensagem (ex.: "gere a receita e agende retorno em 30 dias"),
gere um objeto JSON COMPLETO E INDEPENDENTE para CADA ação, um logo em seguida do outro, cada um no
formato exato {"reply": "...", "action": {...}} — nunca misture os campos de ações diferentes dentro de
um único objeto, e nunca envolva vários objetos em um array. Cada "reply" deve ser curto e falar só
daquela ação específica (ex.: um para a receita, outro para o agendamento).

Se a mensagem não for um pedido de documento nem de agendamento, responda normalmente em texto puro (sem JSON).

QUESTIONÁRIOS RESPONDIDOS PELO PACIENTE
Quando a seção "=== QUESTIONÁRIOS RESPONDIDOS PELO PACIENTE ===" estiver presente no contexto, ela traz
as respostas que o próprio paciente preencheu em formulários enviados pela clínica (um bloco por resposta,
cada um já identificado com o nome do formulário e a data/hora em que foi respondido). Um paciente pode ter
mais de um formulário e até mais de uma resposta para o mesmo formulário ao longo do tempo. Sempre que usar
alguma informação vinda dessa seção para responder ao médico, cite explicitamente o NOME do formulário e a
DATA em que aquela resposta foi registrada (ex.: "Segundo o formulário 'Anamnese inicial', respondido em
12/03/2026, o paciente relatou..."), para deixar claro a origem e a data do dado e evitar que o médico
interprete uma informação antiga como atual. Se houver respostas mais de uma vez para o mesmo formulário,
priorize a mais recente ao responder, mas avise se os dados mudaram entre as respostas ou se a resposta
disponível é antiga e pode estar desatualizada. Nunca invente conteúdo de questionário que não esteja
presente nessa seção.`;

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
1) informações objetivas que deveriam atualizar o cadastro "Informações complementares" do paciente, e
2) qualquer menção a um retorno ou nova consulta que o médico tenha comentado durante o atendimento
(ex.: "volta em 15 dias", "quero reavaliar em um mês", "marca um retorno pra ela").

Este segundo ponto é importante: durante a consulta o médico pode comentar sobre um retorno sem pedir
explicitamente para agendar ali na hora. Você NÃO deve interromper nada em tempo real — este processamento
só roda depois que o atendimento é encerrado. Seu papel é apenas identificar essa menção, se houver, e
propor um agendamento para o médico revisar e confirmar (ele pode editar data/horário/motivo ou descartar).

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

REGRAS PARA "agendamento_sugerido":
- Só preencha quando houver uma menção EXPLÍCITA do médico a um retorno/nova consulta futura para este
  mesmo paciente. Nunca infira um retorno "padrão" quando ninguém falou nisso.
- "prazo_texto": copie o prazo como o médico disse (ex.: "15 dias", "1 mês", "30 dias"), sem calcular datas.
- "data" e "horario": preencha SOMENTE se o médico tiver dito uma data e/ou horário explícitos
  (ex.: "dia 20 às 14h"). Caso contrário deixe como string vazia — quem decide a data final é o médico,
  na hora de confirmar.
- "motivo": frase curta com o motivo do retorno, se mencionado (ex.: "Reavaliação pós-tratamento").
- Se não houver nenhuma menção a retorno/nova consulta, retorne "agendamento_sugerido": null.
- Se "agendamentos_ja_realizados" vier com um ou mais itens, significa que o médico JÁ agendou de
  verdade um ou mais retornos durante esta mesma consulta (não é uma sugestão, são agendamentos reais
  já criados). Neste caso, SEMPRE retorne "agendamento_sugerido": null — nunca proponha um novo, mesmo
  que a fala mencione retorno; o(s) retorno(s) já existe(m).

Retorne EXCLUSIVAMENTE um JSON válido (sem comentários, sem markdown, sem cercas de código) no
formato exato:
{
  "alteracoes": [ { "campo": "nome_do_campo_conforme_recebido", "valor_sugerido": "..." } ],
  "cids_sugeridos": [ { "code": "...", "description": "..." } ],
  "agendamento_sugerido": null
  // ou, quando houver menção clara a retorno:
  // "agendamento_sugerido": { "prazo_texto": "...", "data": "", "horario": "", "motivo": "..." }
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
            const agendamentosJaRealizados = Array.isArray(body.agendamentos_ja_realizados)
              ? body.agendamentos_ja_realizados.filter((a) => a && typeof a === "object")
              : [];
            const ctx = JSON.stringify(
              {
                campos: IC_FIELD_META,
                info_complementar_atual: body.info_complementar_atual ?? {},
                cids_atuais: body.cids_atuais ?? [],
                cid_opcoes: body.cid_opcoes ?? [],
                conteudo_atendimento: conteudo,
                agendamentos_ja_realizados: agendamentosJaRealizados,
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
            // Segurança extra: se já existe pelo menos um agendamento real desta
            // consulta, nunca devolvemos uma sugestão nova — independente do que
            // o modelo tenha respondido (não depende da IA acertar sempre).
            const agRaw = agendamentosJaRealizados.length ? null : parsed.agendamento_sugerido;
            const agendamentoSugerido =
              agRaw && typeof agRaw === "object" && !Array.isArray(agRaw)
                ? {
                    prazo_texto: typeof (agRaw as any).prazo_texto === "string" ? (agRaw as any).prazo_texto : "",
                    data: typeof (agRaw as any).data === "string" ? (agRaw as any).data : "",
                    horario: typeof (agRaw as any).horario === "string" ? (agRaw as any).horario : "",
                    motivo: typeof (agRaw as any).motivo === "string" ? (agRaw as any).motivo : "",
                  }
                : null;
            return Response.json({ alteracoes, cids_sugeridos: cidsSugeridos, agendamento_sugerido: agendamentoSugerido });
          }

          // chat mode
          const history = Array.isArray(body.messages) ? body.messages : [];
          const resumo = (body.resumo_prontuario || "").trim();
          const questionariosPaciente = (body.questionarios_paciente || "").trim();

          // Base de conhecimento local do médico (opcional): se ele tiver bases
          // ativas para o chat_ai, isso injeta o índice delas + os trechos que
          // batem com a última mensagem do usuário. Ver src/lib/base-conhecimento.
          const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
          let medicoId: string | null = null;
          if (token) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: userData } = await supabaseAdmin.auth.getUser(token);
            medicoId = userData.user?.id ?? null;
          }
          const ultimaMensagemUsuario =
            [...history].reverse().find((m) => m?.role === "user")?.content ?? "";
          const { montarContextoBaseConhecimento, MARCADOR_BASE_LOCAL_USADA } = await import(
            "@/lib/base-conhecimento/buscar.server"
          );
          const resultadoBaseConhecimento = await montarContextoBaseConhecimento({
            medicoId,
            mensagem: ultimaMensagemUsuario,
            ia: "chat_ai",
          });

          let analiseExame: AnaliseExame | null = null;
          if (body.anexo?.base64) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            analiseExame = await analisarExameArquivo({
              apiKey,
              anexo: body.anexo,
              paciente: {
                nome: body.paciente_nome ?? null,
                cpf: body.paciente_cpf ?? null,
                data_nascimento: body.paciente_nascimento ?? null,
              },
              buscarTuss: async (termo) => {
                const { data } = await supabaseAdmin.rpc("buscar_tuss", {
                  termo,
                  p_limit: 1,
                  p_usar_alias: true,
                });
                const hit = (data as any[] | null)?.[0];
                return hit ? { id: hit.id, codigo_tuss: hit.codigo_tuss, nome: hit.nome } : null;
              },
            });
          }

          const systemContent =
            SYSTEM_CHAT +
            (resumo
              ? "\n\n=== RESUMO DO PRONTUÁRIO DO PACIENTE ===\n" + resumo
              : "\n\n(Sem resumo de prontuário disponível.)") +
            (questionariosPaciente
              ? "\n\n=== QUESTIONÁRIOS RESPONDIDOS PELO PACIENTE ===\n" + questionariosPaciente
              : "") +
            (analiseExame
              ? `\n\n=== ANÁLISE DE EXAME (IA de exames) — arquivo "${body.anexo?.nome || "anexo"}" ===\n` +
                JSON.stringify(analiseExame, null, 2)
              : "") +
            resultadoBaseConhecimento.texto;
          const messages: ChatMessage[] = [
            { role: "system", content: systemContent },
            ...history.filter(
              (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
            ),
          ];
          const textoBruto = await callGateway(messages, apiKey);
          // A busca por palavra-chave não entende contexto — ela pode achar um trecho
          // "candidato" que na verdade não tem relação com a pergunta. Quem decide se o
          // conteúdo é realmente relevante é a própria IA, sinalizando isso com o
          // marcador (que removemos do texto antes de exibir).
          const usouBaseLocal = textoBruto.includes(MARCADOR_BASE_LOCAL_USADA);
          const text = textoBruto.replaceAll(MARCADOR_BASE_LOCAL_USADA, "").trimEnd();
          return Response.json({
            reply: text,
            analise_exame: analiseExame,
            // Nomes das bases locais que a IA confirmou ter usado nesta resposta (null
            // se nenhuma, ou se a IA considerou os trechos candidatos irrelevantes) — a
            // tela usa isso pra mostrar um selo visual.
            fonte_base_conhecimento:
              usouBaseLocal && resultadoBaseConhecimento.basesCandidatas.length
                ? resultadoBaseConhecimento.basesCandidatas
                : null,
          });
        } catch (err) {
          if (err instanceof Response) return err;
          const msg = err instanceof Error ? err.message : "Unknown error";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
