import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type RequestBody = {
  mode?: string;
  messages?: { role: string; content: string }[];
  user_id?: string | null;
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const TZ_OFFSET_MIN = -180; // America/Sao_Paulo

const SYSTEM = `Você é o Assistente do MediCopilot, usado por médicos e secretárias FORA do contexto de uma consulta em andamento.
Fale sempre em português do Brasil, de forma curta, objetiva e cordial.

Você pode: agendar pacientes, gerar receitas, gerar atestados/declarações, responder perguntas sobre a agenda do dia, enviar mensagens/documentos ao paciente por WhatsApp, criar cadastro de paciente e responder dúvidas de uso do sistema.

REGRAS DE IDENTIFICAÇÃO DO PACIENTE
- Você NÃO sabe quem é o paciente até perguntar. Sempre que uma ação precisar de um paciente ainda não identificado nesta conversa, pergunte o NOME.
- Com o nome, chame a tool buscar_paciente.
  * 1 resultado: peça o CPF para confirmar (evita homônimos). Confirme com confirmar_paciente_cpf. Só então siga com a ação, avisando que reconheceu o cadastro.
  * vários resultados: peça o CPF para desambiguar, ou liste os candidatos com telefone mascarado.
  * nenhum resultado: siga e execute a ação mesmo assim (ex.: gere a receita). NÃO bloqueie a geração do documento por falta de cadastro. O cadastro só é pedido depois, na hora do envio.
- Exceção: para consultas simples (não geração de documento) de um paciente atendido recentemente e com nome único, pode dispensar o CPF.

DADOS OBRIGATÓRIOS PARA RECEITA
- Toda receita precisa de três dados do paciente: nome, CPF e idade. A tool gerar_receita exige os três.
- Se confirmar_paciente_cpf já devolveu a idade (paciente tinha cadastro completo), use esse valor — não pergunte de novo.
- Se o cadastro não existir, ou não tiver CPF/idade registrados, PERGUNTE ao usuário o que estiver faltando — uma pergunta por mensagem, nunca peça vários dados de uma vez.

INTERAÇÃO MEDICAMENTOSA
- Ao chamar gerar_receita com 2+ medicamentos, a tool já verifica interações automaticamente. Se ela responder interacao_detectada=true, pare, explique a interação ao médico em linguagem simples e pergunte se deseja continuar mesmo assim. Só chame gerar_receita de novo, com interacao_confirmada=true, após a confirmação explícita.

APRESENTAÇÃO E POSOLOGIA DOS MEDICAMENTOS
- Se o médico citar um medicamento sem apresentação (dosagem/forma) ou sem posologia, chame buscar_medicamento pelo nome.
  * Se encontrar o medicamento no catálogo, sugira uma das apresentações cadastradas e peça para o médico confirmar (ou escolher outra).
  * Para a posologia não existe catálogo — proponha uma posologia usual para aquela apresentação, deixando claro que é uma sugestão, e peça confirmação do médico antes de incluir na receita.
  * Se não encontrar o medicamento no catálogo, avise e peça que o médico informe a apresentação/posologia manualmente.

APÓS GERAR DOCUMENTO
- Sempre pergunte se deseja enviar por WhatsApp.
- Se o paciente tem cadastro com telefone: ao confirmar, envie (enviar_mensagem com confirmado=true).
- Se não tem cadastro ou não tem telefone: peça o número, chame criar_paciente e só então envie.

CONFIRMAÇÕES OBRIGATÓRIAS
- Nunca envie mensagem/documento ao paciente nem agende/remarque sem confirmação explícita do usuário na conversa. Consultas (agenda, próximo paciente, FAQ) não precisam de confirmação.

OUTRAS REGRAS
- Se o usuário desistir ("deixa pra lá", "cancela"), encerre o fluxo educadamente e siga disponível.
- Pedido ambíguo ou fora dos comandos suportados: converse normalmente / use consultar_faq.
- Atestado sem CID: pergunte se deseja incluir CID ou seguir sem ele.
- Agendamento em horário ocupado: a tool avisa o conflito; sugira os horários alternativos devolvidos.
- Várias ações na mesma frase: trate uma de cada vez, confirmando cada uma.
- Nunca invente dados de paciente, agenda ou medicamentos.`;

const tools = [
  {
    type: "function",
    function: {
      name: "buscar_paciente",
      description: "Busca pacientes cadastrados pelo nome (parcial).",
      parameters: {
        type: "object",
        properties: { nome: { type: "string" } },
        required: ["nome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirmar_paciente_cpf",
      description: "Confirma a identidade do paciente pelo CPF informado.",
      parameters: {
        type: "object",
        properties: { nome: { type: "string" }, cpf: { type: "string" } },
        required: ["cpf"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "criar_paciente",
      description: "Cria um cadastro de paciente.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string" },
          telefone: { type: "string" },
          cpf: { type: "string" },
        },
        required: ["nome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_paciente",
      description: "Agenda um atendimento futuro. Só chame após confirmação explícita do usuário.",
      parameters: {
        type: "object",
        properties: {
          paciente_id: { type: "string" },
          paciente_nome: { type: "string" },
          data: { type: "string", description: "AAAA-MM-DD" },
          horario: { type: "string", description: "HH:MM" },
          motivo: { type: "string" },
          confirmado: { type: "boolean" },
        },
        required: ["paciente_nome", "data", "horario", "confirmado"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_agenda_hoje",
      description: "Resumo da agenda e dos atendimentos concluídos hoje.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "proximo_paciente",
      description: "Próximo atendimento agendado a partir de agora.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "gerar_receita",
      description: "Gera uma receita médica com um ou mais medicamentos.",
      parameters: {
        type: "object",
        properties: {
          paciente_id: { type: "string" },
          paciente_nome: { type: "string" },
          medicamentos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nome: { type: "string" },
                apresentacao: { type: "string" },
                quantidade: { type: "string" },
                posologia: { type: "string" },
              },
              required: ["nome"],
            },
          },
        },
        required: ["paciente_nome", "medicamentos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerar_receita",
      description:
        "Gera uma receita médica com um ou mais medicamentos. Exige nome, CPF e idade do paciente. Se houver 2+ medicamentos, verifica interação automaticamente.",
      parameters: {
        type: "object",
        properties: {
          paciente_id: { type: "string" },
          paciente_nome: { type: "string" },
          paciente_cpf: { type: "string" },
          paciente_idade: { type: "number", description: "Idade do paciente em anos" },
          interacao_confirmada: {
            type: "boolean",
            description:
              "true somente depois que o médico confirmar que quer seguir mesmo havendo interação apontada anteriormente",
          },
          medicamentos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nome: { type: "string" },
                apresentacao: { type: "string" },
                quantidade: { type: "string" },
                posologia: { type: "string" },
              },
              required: ["nome"],
            },
          },
        },
        required: ["paciente_nome", "paciente_cpf", "paciente_idade", "medicamentos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_medicamento",
      description:
        "Busca um medicamento no catálogo para sugerir apresentações existentes quando o médico não informou uma.",
      parameters: {
        type: "object",
        properties: { nome: { type: "string" } },
        required: ["nome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enviar_mensagem",
      description: "Envia mensagem ou documento ao paciente. Só chame após confirmação explícita.",
      parameters: {
        type: "object",
        properties: {
          paciente_id: { type: "string" },
          paciente_nome: { type: "string" },
          texto: { type: "string" },
          canal: { type: "string", enum: ["whatsapp"] },
          documento_id: { type: "string" },
          confirmado: { type: "boolean" },
        },
        required: ["texto", "confirmado"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_faq",
      description: "Consulta a base de conhecimento de uso do sistema.",
      parameters: {
        type: "object",
        properties: { pergunta: { type: "string" } },
        required: ["pergunta"],
      },
    },
  },
];

function maskPhone(tel?: string | null) {
  const d = (tel || "").replace(/\D/g, "");
  if (d.length < 4) return tel || null;
  return "•••••" + d.slice(-4);
}

function onlyDigits(v?: string | null) {
  return (v || "").replace(/\D/g, "");
}

function localDayRange(date = new Date()) {
  const local = new Date(date.getTime() + TZ_OFFSET_MIN * 60000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const start = new Date(Date.UTC(y, m, d) - TZ_OFFSET_MIN * 60000);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

function toIsoFromLocal(data: string, horario: string) {
  const [y, mo, d] = data.split("-").map(Number);
  const [h, mi] = horario.split(":").map(Number);
  if (!y || !mo || !d || Number.isNaN(h)) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi || 0) - TZ_OFFSET_MIN * 60000);
}

function calcIdade(nasc?: string | null): number | null {
  if (!nasc) return null;
  const d = new Date(nasc.length <= 10 ? `${nasc}T00:00:00` : nasc);
  if (Number.isNaN(d.getTime())) return null;
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const mo = n.getMonth() - d.getMonth();
  if (mo < 0 || (mo === 0 && n.getDate() < d.getDate())) a--;
  return a >= 0 ? a : null;
}

function fmtHora(iso: string) {
  const dt = new Date(new Date(iso).getTime() + TZ_OFFSET_MIN * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}

type Db = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

type ToolCtx = { db: Db; medicoId: string | null; pendingAction: { value: unknown } };

async function runTool(name: string, args: Record<string, any>, ctx: ToolCtx): Promise<unknown> {
  const { db, medicoId } = ctx;

  switch (name) {
    case "buscar_paciente": {
      let q = db
        .from("pacientes")
        .select("paciente_id,name,telefone,cpf,data_nascimento")
        .ilike("name", `%${String(args.nome || "").trim()}%`)
        .limit(8);
      if (medicoId) q = q.eq("user_id", medicoId);
      const { data, error } = await q;
      if (error) return { erro: error.message };
      return {
        total: data?.length ?? 0,
        pacientes: (data ?? []).map((p) => ({
          paciente_id: p.paciente_id,
          nome: p.name,
          telefone_mascarado: maskPhone(p.telefone),
          tem_telefone: !!p.telefone,
          tem_cpf: !!p.cpf,
        })),
      };
    }

    case "confirmar_paciente_cpf": {
      const cpf = onlyDigits(args.cpf);
      let q = db.from("pacientes").select("paciente_id,name,telefone,cpf,data_nascimento").limit(50);
      if (medicoId) q = q.eq("user_id", medicoId);
      if (args.nome) q = q.ilike("name", `%${String(args.nome).trim()}%`);
      const { data, error } = await q;
      if (error) return { erro: error.message };
      const found = (data ?? []).find((p) => onlyDigits(p.cpf) === cpf);
      if (!found) return { confirmado: false, motivo: "CPF não confere com nenhum cadastro." };
      return {
        confirmado: true,
        paciente_id: found.paciente_id,
        nome: found.name,
        tem_telefone: !!found.telefone,
        telefone_mascarado: maskPhone(found.telefone),
        idade: calcIdade(found.data_nascimento),
      };
    }

    case "criar_paciente": {
      if (!medicoId) return { erro: "Usuário não identificado na sessão." };
      const { data, error } = await db
        .from("pacientes")
        .insert({
          user_id: medicoId,
          name: String(args.nome || "").trim(),
          telefone: args.telefone ? String(args.telefone) : null,
          cpf: args.cpf ? String(args.cpf) : null,
        })
        .select("paciente_id,name,telefone")
        .single();
      if (error) return { erro: error.message };
      ctx.pendingAction.value = { type: "criar_paciente", paciente_id: data.paciente_id };
      return { criado: true, paciente_id: data.paciente_id, nome: data.name };
    }

    case "agendar_paciente": {
      if (!args.confirmado) return { erro: "Peça a confirmação explícita antes de agendar." };
      if (!medicoId) return { erro: "Usuário não identificado na sessão." };
      const dt = toIsoFromLocal(String(args.data), String(args.horario));
      if (!dt) return { erro: "Data ou horário inválido." };
      const janelaIni = new Date(dt.getTime() - 29 * 60000).toISOString();
      const janelaFim = new Date(dt.getTime() + 29 * 60000).toISOString();
      const { data: conflitos } = await db
        .from("agendamentos")
        .select("data_hora,paciente_nome")
        .eq("id_medico", medicoId)
        .neq("status", "cancelado")
        .gte("data_hora", janelaIni)
        .lte("data_hora", janelaFim);
      if (conflitos && conflitos.length) {
        const alternativas = [60, 120, -60].map((m) => fmtHora(new Date(dt.getTime() + m * 60000).toISOString()));
        return {
          conflito: true,
          ocupado_por: conflitos[0].paciente_nome,
          horario_solicitado: fmtHora(dt.toISOString()),
          alternativas,
        };
      }
      const { data, error } = await db
        .from("agendamentos")
        .insert({
          id_medico: medicoId,
          paciente_id: args.paciente_id || null,
          paciente_nome: args.paciente_nome || null,
          data_hora: dt.toISOString(),
          motivo: args.motivo || null,
          status: "agendado",
        })
        .select("id,data_hora")
        .single();
      if (error) return { erro: error.message };
      ctx.pendingAction.value = {
        type: "agendar_paciente",
        agendamento_id: data.id,
        paciente_id: args.paciente_id || null,
        paciente_nome: args.paciente_nome || null,
        data_hora: data.data_hora,
      };
      return { agendado: true, quando: fmtHora(data.data_hora) };
    }

    case "consultar_agenda_hoje": {
      if (!medicoId) return { erro: "Usuário não identificado na sessão." };
      const { start, end } = localDayRange();
      const { data: atendidos } = await db
        .from("consulta")
        .select("id,started_at,ended_at,acao,title")
        .eq("id_medico", medicoId)
        .gte("started_at", start.toISOString())
        .lt("started_at", end.toISOString());
      const { data: agenda } = await db
        .from("agendamentos")
        .select("data_hora,paciente_nome,status,motivo")
        .eq("id_medico", medicoId)
        .neq("status", "cancelado")
        .gte("data_hora", start.toISOString())
        .lt("data_hora", end.toISOString())
        .order("data_hora");
      const concluidos = (atendidos ?? []).filter((a) => a.acao !== "Rascunho");
      return {
        atendimentos_hoje: atendidos?.length ?? 0,
        concluidos_hoje: concluidos.length,
        agendados_hoje: agenda?.length ?? 0,
        agenda: (agenda ?? []).map((a) => ({
          hora: fmtHora(a.data_hora),
          paciente: a.paciente_nome,
          motivo: a.motivo,
          status: a.status,
        })),
      };
    }

    case "proximo_paciente": {
      if (!medicoId) return { erro: "Usuário não identificado na sessão." };
      const { data } = await db
        .from("agendamentos")
        .select("data_hora,paciente_nome,motivo")
        .eq("id_medico", medicoId)
        .neq("status", "cancelado")
        .gte("data_hora", new Date().toISOString())
        .order("data_hora")
        .limit(1);
      const next = data?.[0];
      if (!next) return { proximo: null };
      return {
        proximo: {
          quando: fmtHora(next.data_hora),
          paciente: next.paciente_nome,
          motivo: next.motivo,
        },
      };
    }

    case "gerar_receita": {
      const medicamentos = Array.isArray(args.medicamentos) ? args.medicamentos : [];
      if (!medicamentos.length) return { erro: "Informe ao menos um medicamento." };
      if (!String(args.paciente_cpf || "").trim()) {
        return {
          erro: "faltam_dados_paciente",
          faltando: "cpf",
          instrucao: "Peça o CPF do paciente antes de gerar a receita.",
        };
      }
      if (args.paciente_idade === undefined || args.paciente_idade === null || args.paciente_idade === "") {
        return {
          erro: "faltam_dados_paciente",
          faltando: "idade",
          instrucao: "Peça a idade do paciente antes de gerar a receita.",
        };
      }

      if (medicamentos.length >= 2 && !args.interacao_confirmada) {
        const termos = medicamentos.map((m: any) => String(m?.nome || "").trim()).filter(Boolean);
        const { data: interacoes } = await db.rpc("verificar_interacoes", { p_termos: termos });
        if (interacoes && interacoes.length) {
          return {
            interacao_detectada: true,
            interacoes: interacoes.map((i: any) => ({
              farmaco_1: i.farmaco_1,
              farmaco_2: i.farmaco_2,
              acao: i.acao,
              recomendacoes: i.recomendacoes,
            })),
            instrucao:
              "Explique a interação ao médico em linguagem simples e peça confirmação explícita antes de gerar. Só chame gerar_receita de novo com interacao_confirmada=true.",
          };
        }
      }

      let documentoId: string | null = null;
      if (medicoId) {
        const { data } = await db
          .from("documentos_paciente")
          .insert({
            id_medico: medicoId,
            paciente_id: args.paciente_id || null,
            paciente_nome: args.paciente_nome || null,
            tipo: "receita",
            conteudo: { medicamentos, paciente_cpf: args.paciente_cpf, paciente_idade: args.paciente_idade },
          })
          .select("id")
          .single();
        documentoId = data?.id ?? null;
      }
      ctx.pendingAction.value = {
        type: "gerar_receita",
        documento_id: documentoId,
        paciente_id: args.paciente_id || null,
        paciente_nome: args.paciente_nome || null,
        paciente_cpf: args.paciente_cpf || null,
        paciente_idade: args.paciente_idade ?? null,
        medicamentos,
      };
      return { gerado: true, documento_id: documentoId, medicamentos: medicamentos.length };
    }

    case "buscar_medicamento": {
      const termo = String(args.nome || "").trim();
      if (!termo) return { erro: "Informe o nome do medicamento." };
      const { data, error } = await db
        .from("medicamentos")
        .select("nome_comercial,composicao,apresentacoes,fabricante")
        .ilike("nome_comercial", `%${termo}%`)
        .limit(5);
      if (error) return { erro: error.message };
      if (!data || !data.length) return { encontrado: false };
      return {
        encontrado: true,
        opcoes: data.map((m) => ({
          nome_comercial: m.nome_comercial,
          composicao: m.composicao,
          apresentacoes: m.apresentacoes || [],
          fabricante: m.fabricante,
        })),
      };
    }

    case "gerar_atestado": {
      const tipo = args.tipo === "declaracao" ? "declaracao" : "atestado";
      let documentoId: string | null = null;
      const conteudo = {
        tipo,
        dias: args.dias ?? null,
        cid: args.cid ?? null,
        observacao: args.observacao ?? null,
      };
      if (medicoId) {
        const { data } = await db
          .from("documentos_paciente")
          .insert({
            id_medico: medicoId,
            paciente_id: args.paciente_id || null,
            paciente_nome: args.paciente_nome || null,
            tipo,
            conteudo,
          })
          .select("id")
          .single();
        documentoId = data?.id ?? null;
      }
      ctx.pendingAction.value = {
        type: "gerar_atestado",
        documento_id: documentoId,
        paciente_id: args.paciente_id || null,
        paciente_nome: args.paciente_nome || null,
        ...conteudo,
      };
      return { gerado: true, documento_id: documentoId, ...conteudo };
    }

    case "enviar_mensagem": {
      if (!args.confirmado) return { erro: "Peça a confirmação explícita antes de enviar." };
      let telefone: string | null = null;
      let nome: string | null = args.paciente_nome || null;
      if (args.paciente_id) {
        const { data } = await db
          .from("pacientes")
          .select("name,telefone")
          .eq("paciente_id", args.paciente_id)
          .maybeSingle();
        telefone = data?.telefone ?? null;
        nome = data?.name ?? nome;
      }
      if (!telefone) {
        return {
          enviado: false,
          motivo: "sem_telefone",
          instrucao: "Peça o número de WhatsApp do paciente e crie/atualize o cadastro antes de enviar.",
        };
      }
      if (args.documento_id && medicoId) {
        await db
          .from("documentos_paciente")
          .update({ enviado_em: new Date().toISOString(), canal_envio: "whatsapp" })
          .eq("id", args.documento_id)
          .eq("id_medico", medicoId);
      }
      ctx.pendingAction.value = {
        type: "enviar_mensagem",
        canal: "whatsapp",
        paciente_id: args.paciente_id || null,
        paciente_nome: nome,
        contato: telefone,
        texto: args.texto,
        documento_id: args.documento_id || null,
      };
      return { enviado: true, para: nome, telefone_mascarado: maskPhone(telefone) };
    }

    case "consultar_faq":
      return {
        encontrado: false,
        resposta:
          "A base de ajuda do sistema ainda não está disponível. Responda com o que souber do fluxo do app e ofereça ajuda humana se necessário.",
      };

    default:
      return { erro: `Tool desconhecida: ${name}` };
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
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Response(`AI gateway error ${res.status}: ${text}`, { status: res.status });
  }
  const data = (await res.json()) as { choices?: { message?: ChatMessage }[] };
  return data.choices?.[0]?.message ?? ({ role: "assistant", content: "" } as ChatMessage);
}

export const Route = createFileRoute("/api/assistente-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: RequestBody;
        try {
          body = (await request.json()) as RequestBody;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const history = (Array.isArray(body.messages) ? body.messages : []).filter(
          (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
        ) as ChatMessage[];

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const pendingAction: { value: unknown } = { value: null };
        const ctx: ToolCtx = {
          db: supabaseAdmin,
          medicoId: body.user_id || null,
          pendingAction,
        };

        const agora = new Date(Date.now() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 16);
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: `${SYSTEM}\n\nData e hora atuais (America/Sao_Paulo): ${agora}`,
          },
          ...history,
        ];

        try {
          for (let step = 0; step < 8; step++) {
            const msg = await callGateway(messages, apiKey);
            messages.push(msg);
            const calls = msg.tool_calls ?? [];
            if (!calls.length) {
              return Response.json({
                reply: (msg.content || "").trim(),
                action: pendingAction.value,
              });
            }
            for (const call of calls) {
              let args: Record<string, any> = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch {
                args = {};
              }
              let result: unknown;
              try {
                result = await runTool(call.function.name, args, ctx);
              } catch (e) {
                result = { erro: e instanceof Error ? e.message : "Falha na execução" };
              }
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(result),
              });
            }
          }
          return Response.json({
            reply: "Não consegui concluir essa solicitação agora. Pode reformular?",
            action: pendingAction.value,
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
