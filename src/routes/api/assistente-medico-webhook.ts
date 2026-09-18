import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do WhatsApp para o canal Médico ↔ assistente_ai.
 *
 * Diferente de whatsapp-webhook.ts (que atende PACIENTES escrevendo para o
 * número da CLÍNICA, um número por médico via medico_whatsapp_config), esta
 * rota atende o número ÚNICO do próprio app — o mesmo para todos os médicos —
 * usado para conversar com o assistente com permissão completa (gerar
 * receita, exame, atestado, consultar/editar agenda etc. — canal "interno").
 *
 * Identificação: o médico é encontrado comparando o telefone de quem mandou
 * a mensagem com o campo "telefone" salvo no user_metadata de cada usuário
 * (tela Configurações > Minha equipe > Meu usuário). Essa rota NÃO usa
 * medico_whatsapp_config — essa tabela é exclusiva do canal paciente/clínica.
 *
 * Controle de acesso: além de achar o telefone, confere user_metadata.tipo_user
 * (gravado no cadastro, veja medicopilot.html) — só libera acesso completo
 * (gerar receita, exame, atestado, mexer na agenda) para tipo_user "medico".
 * Qualquer outro cargo cadastrado com esse telefone é recusado explicitamente.
 *
 * Para continuar a mesma conversa a cada nova mensagem (em vez de criar uma
 * conversa nova em ia_assist_conversas, com título gerado, toda hora), o
 * mapeamento telefone -> conversa fica em medico_assistente_sessoes_whatsapp.
 *
 * Encerrar/trocar de assunto: duas formas de zerar o contexto acumulado,
 * pra evitar que um assunto antigo "vaze" pra pergunta seguinte —
 *  1) Comando explícito (FRASES_NOVO_ASSUNTO) — ex.: "outro assunto",
 *     "mudando de assunto". Zera na hora, sem chamar a IA.
 *  2) Expiração automática (INATIVIDADE_MS) — se a última mensagem foi há
 *     mais de 30min, a próxima já começa um assunto novo sozinha.
 *
 * Requer as MESMAS variáveis de ambiente globais do outro webhook:
 *   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN
 *   (e opcionalmente WHATSAPP_APP_SECRET)
 *
 * IMPORTANTE: no painel do Meta, a "URL de retorno de chamada" configurada
 * para o número do assistente_ai deve apontar para ESTA rota
 * (/api/assistente-medico-webhook) — não para /api/whatsapp-webhook, que é
 * do número da clínica.
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const MAX_HISTORICO = 20; // mensagens mantidas por conversa, para não crescer sem limite

// Depois de quanto tempo sem mensagem uma conversa é considerada "encerrada"
// sozinha — a próxima mensagem começa um assunto novo automaticamente, sem
// precisar de comando. 30 minutos é o valor inicial; ajuste aqui se precisar.
const INATIVIDADE_MS = 30 * 60 * 1000;

// Frases que, quando o médico manda, encerram o assunto atual na hora — sem
// gastar uma chamada de IA para isso. Comparação é por inclusão de substring
// já normalizada (sem acento, minúsculas), então variações de pontuação ou
// maiúsculas não importam.
const FRASES_NOVO_ASSUNTO = [
  "outro assunto",
  "mudando de assunto",
  "vamos mudar de assunto",
  "e so isso, obrigado",
  "e so isso obrigado",
];

function normalizarTexto(v: string) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function pedeNovoAssunto(texto: string) {
  const normalizado = normalizarTexto(texto);
  return FRASES_NOVO_ASSUNTO.some((frase) => normalizado.includes(frase));
}

function onlyDigits(v?: string | null) {
  return (v || "").replace(/\D/g, "");
}

// Compara os últimos 8 dígitos — essa é a parte do número que nunca muda,
// então evita falso-negativo por causa de:
//  - DDI (55) presente em um lado e ausente no outro;
//  - o "9º dígito" dos celulares brasileiros: a Meta às vezes entrega o
//    "from" da mensagem SEM esse dígito extra, mesmo o número tendo sido
//    cadastrado com ele (ou vice-versa). Os últimos 8 dígitos (o número em
//    si, sem DDD/DDI/9º dígito) continuam iguais nos dois formatos.
function telefonesEquivalentes(a?: string | null, b?: string | null) {
  const da = onlyDigits(a);
  const dbNum = onlyDigits(b);
  if (da.length < 8 || dbNum.length < 8) return false;
  return da.slice(-8) === dbNum.slice(-8);
}

type Db = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

// Confirma que a chamada realmente veio da Meta (HMAC-SHA256 do corpo com o App Secret).
// Mesma lógica de whatsapp-webhook.ts.
async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // segredo não configurado — mantém comportamento anterior
  const signature = req.headers.get("x-hub-signature-256");
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function enviarWhatsApp(para: string, texto: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error(
      "[assistente-medico-webhook] WHATSAPP_ACCESS_TOKEN ou WHATSAPP_PHONE_NUMBER_ID ausente — resposta não enviada.",
    );
    return;
  }
  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: para,
        type: "text",
        text: { body: texto.slice(0, 4096) },
      }),
    });
    if (!res.ok) console.error("[assistente-medico-webhook] Falha ao enviar mensagem:", res.status, await res.text());
  } catch (e) {
    console.error("[assistente-medico-webhook] Erro de rede ao enviar mensagem:", e);
  }
}

// Mesmo critério usado na tela "Minha equipe" (public/equipe.js: isDoctor) —
// mantém consistência com o resto do app sobre o que conta como "médico".
function isMedico(tipoUser: unknown) {
  return String(tipoUser || "")
    .toLowerCase()
    .includes("medic");
}

// Percorre os usuários do Supabase Auth procurando aquele cujo telefone
// cadastrado (Configurações > Minha equipe > Meu usuário, user_metadata.telefone)
// bate com quem mandou a mensagem. Não existe hoje uma tabela pública indexada
// por telefone de médico — se a base crescer muito, vale criar uma (atualizada
// no momento em que o médico salva o campo) para não paginar todos os
// usuários a cada mensagem recebida.
//
// Também confere o cargo (user_metadata.tipo_user, gravado no cadastro —
// veja medicopilot.html, signUp). Esse canal dá acesso completo (gerar
// receita, exame, atestado, mexer na agenda), então só libera para quem tem
// tipo_user "medico" — mesmo que o telefone bata com um usuário cadastrado
// de outro cargo (ex.: secretária, quando esse tipo de conta existir).
async function resolverMedicoPorTelefone(
  db: Db,
  telefoneRemetente: string,
): Promise<{ id: string; isMedico: boolean } | null> {
  const PER_PAGE = 200;
  const MAX_PAGINAS = 25; // cobre até 5.000 usuários
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data?.users?.length) break;
    for (const user of data.users) {
      const meta = (user.user_metadata || {}) as Record<string, unknown>;
      const telefoneCadastrado = (meta.telefone as string) || (meta.phone as string) || "";
      if (telefonesEquivalentes(telefoneCadastrado, telefoneRemetente)) {
        return { id: user.id, isMedico: isMedico(meta.tipo_user) };
      }
    }
    if (data.users.length < PER_PAGE) break; // última página
  }
  return null;
}

async function carregarSessao(db: Db, idMedico: string, telefone: string) {
  const { data } = await db
    .from("medico_assistente_sessoes_whatsapp")
    .select("id,conversa_id,ultima_interacao")
    .eq("id_medico", idMedico)
    .eq("telefone", telefone)
    .maybeSingle();
  return data ?? null;
}

async function carregarHistoricoConversa(db: Db, idMedico: string, conversaId: string | null) {
  if (!conversaId) return [] as { role: string; content: string }[];
  // Confere id_medico também — não só por segurança, mas porque se o
  // conversa_id guardado na sessão não pertencer (mais) a este médico
  // (ex.: registro antigo de teste, conversa apagada/reatribuída), é
  // melhor começar do zero silenciosamente do que arriscar carregar o
  // histórico de uma conversa errada e confundir a IA com um assunto que
  // não tem nada a ver com a mensagem atual.
  const { data } = await db
    .from("ia_assist_conversas")
    .select("mensagens")
    .eq("id", conversaId)
    .eq("id_medico", idMedico)
    .maybeSingle();
  const bruto = Array.isArray(data?.mensagens) ? data!.mensagens : [];
  return bruto
    .filter((m): m is { role: string; content: string } => !!m && typeof m === "object" && !Array.isArray(m))
    .map((m) => ({ role: String((m as any).role || "user"), content: String((m as any).content || "") }))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_HISTORICO);
}

async function salvarSessao(
  db: Db,
  sessaoId: string | null,
  idMedico: string,
  telefone: string,
  conversaId: string | null,
) {
  if (sessaoId) {
    await db
      .from("medico_assistente_sessoes_whatsapp")
      .update({ conversa_id: conversaId, ultima_interacao: new Date().toISOString() })
      .eq("id", sessaoId);
    return;
  }
  await db.from("medico_assistente_sessoes_whatsapp").insert({
    id_medico: idMedico,
    telefone,
    conversa_id: conversaId,
  });
}

export const Route = createFileRoute("/api/assistente-medico-webhook")({
  server: {
    handlers: {
      // Verificação do webhook (handshake exigido pela Meta Cloud API ao cadastrar a URL).
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
          return new Response(challenge || "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const rawBody = await request.text();

        const isValid = await verifySignature(request, rawBody);
        if (!isValid) {
          return new Response("Invalid signature", { status: 401 });
        }

        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const value = body?.entry?.[0]?.changes?.[0]?.value;
        const msg = value?.messages?.[0];
        const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
        const messageType: string = msg?.type || "text";
        const textoRecebido: string =
          messageType === "text" ? (msg?.text?.body || "") : `[mensagem do tipo ${messageType}]`;
        const telefoneRemetente = onlyDigits(msg?.from);

        // Eventos que não são mensagem de texto (status de entrega, etc.) — apenas confirma recebimento.
        if (!msg || !telefoneRemetente) {
          return Response.json({ ok: true });
        }

        // Guarda de segurança: se por engano essa rota receber tráfego de outro
        // número (ex.: webhook configurado errado no painel do Meta), não
        // processa — evita misturar com o fluxo de paciente.
        const numeroEsperado = process.env.WHATSAPP_PHONE_NUMBER_ID;
        if (numeroEsperado && phoneNumberId && phoneNumberId !== numeroEsperado) {
          console.warn(
            "[assistente-medico-webhook] phone_number_id inesperado, ignorando:",
            phoneNumberId,
          );
          return Response.json({ ok: true });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Registra a mensagem recebida no log bruto de mensagens (mesmo log usado pelo outro webhook).
        await supabaseAdmin.from("whatsapp_messages").insert({
          wa_from: telefoneRemetente,
          direction: "inbound",
          message_type: messageType,
          content: textoRecebido,
          wa_message_id: msg.id ?? null,
        });

        const medico = await resolverMedicoPorTelefone(supabaseAdmin, telefoneRemetente);
        if (!medico) {
          const aviso =
            "Olá! Não encontrei nenhum médico cadastrado com este número. " +
            "Confirme se o telefone está salvo em Configurações > Minha equipe > Meu usuário e tente novamente.";
          await enviarWhatsApp(telefoneRemetente, aviso);
          console.warn(
            "[assistente-medico-webhook] Nenhum médico encontrado para o telefone remetente",
            telefoneRemetente,
          );
          return Response.json({ ok: true });
        }

        if (!medico.isMedico) {
          const aviso =
            "Olá! Este número está cadastrado no sistema, mas não com permissão de médico — " +
            "este canal é exclusivo para médicos gerarem receita, atestado, exame ou mexer na agenda. " +
            "Se isso não deveria estar assim, fale com o responsável da clínica.";
          await enviarWhatsApp(telefoneRemetente, aviso);
          console.warn(
            "[assistente-medico-webhook] Telefone pertence a usuário sem cargo de médico (tipo_user), acesso negado:",
            telefoneRemetente,
            "user_id:",
            medico.id,
          );
          return Response.json({ ok: true });
        }

        const sessao = await carregarSessao(supabaseAdmin, medico.id, telefoneRemetente);

        // Comando explícito para encerrar o assunto atual — não gasta chamada
        // de IA, só zera o vínculo com a conversa anterior e confirma.
        if (pedeNovoAssunto(textoRecebido)) {
          await salvarSessao(supabaseAdmin, sessao?.id || null, medico.id, telefoneRemetente, null);
          const confirmacao = "Prontinho, encerrei o assunto anterior! Em que posso ajudar agora?";
          await enviarWhatsApp(telefoneRemetente, confirmacao);
          await supabaseAdmin.from("whatsapp_messages").insert({
            wa_from: telefoneRemetente,
            direction: "outbound",
            message_type: "text",
            content: confirmacao,
          });
          return Response.json({ ok: true });
        }

        // Expiração automática: se a última mensagem foi há muito tempo,
        // trata como assunto novo sozinho (sem precisar de comando), pra não
        // herdar contexto de uma conversa que na prática já tinha terminado.
        const inativa =
          !!sessao?.ultima_interacao && Date.now() - new Date(sessao.ultima_interacao).getTime() > INATIVIDADE_MS;
        const conversaIdParaContinuar = inativa ? null : sessao?.conversa_id || null;
        if (inativa) {
          console.log(
            "[assistente-medico-webhook] Sessão inativa há mais de",
            INATIVIDADE_MS / 60000,
            "min, iniciando assunto novo para",
            telefoneRemetente,
          );
        }

        const historico = await carregarHistoricoConversa(supabaseAdmin, medico.id, conversaIdParaContinuar);
        const novoHistorico = [...historico, { role: "user", content: textoRecebido }];

        try {
          const { handleAssistente } = await import("./assistente-ia");
          const res = await handleAssistente({
            canal: "interno",
            messages: novoHistorico,
            user_id: medico.id,
            conversa_id: conversaIdParaContinuar,
          });
          const data = (await res.json()) as { reply?: string; conversa_id?: string | null };
          const reply = (data.reply || "Desculpe, não consegui responder agora. Tente novamente em instantes.").trim();

          await salvarSessao(
            supabaseAdmin,
            sessao?.id || null,
            medico.id,
            telefoneRemetente,
            data.conversa_id || conversaIdParaContinuar,
          );
          await enviarWhatsApp(telefoneRemetente, reply);
          await supabaseAdmin.from("whatsapp_messages").insert({
            wa_from: telefoneRemetente,
            direction: "outbound",
            message_type: "text",
            content: reply,
          });
        } catch (e) {
          console.error("[assistente-medico-webhook] Falha ao processar mensagem:", e);
          await enviarWhatsApp(
            telefoneRemetente,
            "Desculpe, tive um problema para responder agora. Tente novamente em instantes.",
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});
