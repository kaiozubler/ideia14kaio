import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do WhatsApp (compatível com o formato da Meta Cloud API) usado para o
 * autoatendimento de agendamento pelo paciente.
 *
 * Fluxo:
 * 1) O paciente manda mensagem para o número de WhatsApp do consultório.
 * 2) Identificamos o médico dono daquele número (medico_whatsapp_config.phone_number_id).
 * 3) Identificamos o paciente pelo telefone (cadastro existente OU criamos um registro
 *    mínimo, só com nome do WhatsApp e telefone — sem dados clínicos).
 * 4) Carregamos/gravamos o histórico curto da conversa (whatsapp_conversas) e chamamos
 *    o assistente em modo restrito (canal:"paciente"), que só pode agendar/consultar/
 *    cancelar o PRÓPRIO atendimento — nunca acessa dados de outros pacientes nem gera
 *    documentos clínicos.
 * 5) Respondemos ao paciente pela própria Cloud API.
 *
 * Requer as variáveis de ambiente:
 *   WHATSAPP_ACCESS_TOKEN  — token do WhatsApp Business (Meta Cloud API)
 *   WHATSAPP_VERIFY_TOKEN  — token arbitrário usado na verificação do webhook (GET)
 *   PUBLIC_BASE_URL        — usado para montar a URL interna do assistente (opcional)
 */

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const MAX_HISTORICO = 20; // mensagens mantidas por conversa, para não crescer sem limite

function onlyDigits(v?: string | null) {
  return (v || "").replace(/\D/g, "");
}

type Db = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

// Confirma que a chamada realmente veio da Meta (HMAC-SHA256 do corpo com o App Secret).
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
  // Comparação em tempo constante
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function enviarWhatsApp(phoneNumberId: string, para: string, texto: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    console.error("[whatsapp-webhook] WHATSAPP_ACCESS_TOKEN ausente — resposta não enviada.");
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
    if (!res.ok) console.error("[whatsapp-webhook] Falha ao enviar mensagem:", res.status, await res.text());
  } catch (e) {
    console.error("[whatsapp-webhook] Erro de rede ao enviar mensagem:", e);
  }
}

async function resolverMedicoPorNumero(db: Db, phoneNumberId: string) {
  const { data } = await db
    .from("medico_whatsapp_config")
    .select("id_medico,agendamento_ativo")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  return data ?? null;
}

async function resolverOuCriarPaciente(db: Db, medicoId: string, telefone: string, nomeWhatsapp: string) {
  const { data: existente } = await db
    .from("pacientes")
    .select("paciente_id,name,telefone")
    .eq("user_id", medicoId)
    .eq("telefone", telefone)
    .maybeSingle();
  if (existente) return existente;
  const { data: criado, error } = await db
    .from("pacientes")
    .insert({ user_id: medicoId, name: nomeWhatsapp || "Paciente WhatsApp", telefone, convenio: "Particular" })
    .select("paciente_id,name,telefone")
    .single();
  if (error) {
    console.error("[whatsapp-webhook] Falha ao criar paciente mínimo:", error.message);
    return null;
  }
  return criado;
}

async function carregarConversa(db: Db, medicoId: string, telefone: string) {
  const { data } = await db
    .from("whatsapp_conversas")
    .select("id,paciente_id,mensagens")
    .eq("id_medico", medicoId)
    .eq("telefone", telefone)
    .maybeSingle();
  return data ?? null;
}

async function salvarConversa(
  db: Db,
  medicoId: string,
  telefone: string,
  pacienteId: string | null,
  conversaId: string | null,
  mensagens: { role: string; content: string }[],
) {
  const cortadas = mensagens.slice(-MAX_HISTORICO);
  if (conversaId) {
    await db
      .from("whatsapp_conversas")
      .update({ mensagens: cortadas, ultima_interacao: new Date().toISOString(), paciente_id: pacienteId })
      .eq("id", conversaId);
    return;
  }
  await db.from("whatsapp_conversas").insert({
    id_medico: medicoId,
    telefone,
    paciente_id: pacienteId,
    mensagens: cortadas,
  });
}

export const Route = createFileRoute("/api/whatsapp-webhook")({
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

        // Formato Meta Cloud API: entry[].changes[].value.{metadata,messages,contacts}
        const value = body?.entry?.[0]?.changes?.[0]?.value;
        const msg = value?.messages?.[0];
        const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
        const messageType: string = msg?.type || "text";
        const textoRecebido: string = messageType === "text" ? (msg?.text?.body || "") : `[mensagem do tipo ${messageType}]`;
        const nomeWhatsapp: string = value?.contacts?.[0]?.profile?.name || "";
        const telefonePaciente = onlyDigits(msg?.from);

        // Eventos que não são mensagem de texto (status de entrega, etc.) — apenas confirma recebimento.
        if (!phoneNumberId || !msg || !telefonePaciente) {
          return Response.json({ ok: true });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Registra a mensagem recebida no log bruto de mensagens.
        await supabaseAdmin.from("whatsapp_messages").insert({
          wa_from: telefonePaciente,
          direction: "inbound",
          message_type: messageType,
          content: textoRecebido,
          wa_message_id: msg.id ?? null,
        });

        const config = await resolverMedicoPorNumero(supabaseAdmin, phoneNumberId);
        if (!config) {
          console.warn("[whatsapp-webhook] Nenhum médico configurado para phone_number_id", phoneNumberId);
          return Response.json({ ok: true });
        }
        if (!config.agendamento_ativo) {
          const aviso = "Olá! O agendamento automático por aqui está temporariamente desativado. Por favor, entre em contato diretamente com a clínica.";
          await enviarWhatsApp(phoneNumberId, telefonePaciente, aviso);
          await supabaseAdmin.from("whatsapp_messages").insert({
            wa_from: telefonePaciente,
            direction: "outbound",
            message_type: "text",
            content: aviso,
          });
          return Response.json({ ok: true });
        }

        const paciente = await resolverOuCriarPaciente(supabaseAdmin, config.id_medico, telefonePaciente, nomeWhatsapp);
        const conversa = await carregarConversa(supabaseAdmin, config.id_medico, telefonePaciente);
        const historicoRaw = Array.isArray(conversa?.mensagens) ? conversa!.mensagens : [];
        const historico: { role: string; content: string }[] = historicoRaw
          .filter((m): m is { role: string; content: string } => !!m && typeof m === "object" && !Array.isArray(m))
          .map((m) => ({ role: String((m as any).role || "user"), content: String((m as any).content || "") }));
        const novoHistorico = [...historico, { role: "user", content: textoRecebido }];

        try {
          // Reaproveita a mesma lógica/tools do assistente interno, em modo restrito.
          const { Route: AssistenteRoute } = await import("./assistente-ia");
          const handler = (AssistenteRoute as any).options.server.handlers.POST as (arg: {
            request: Request;
          }) => Promise<Response>;
          const fakeRequest = new Request("http://internal/api/assistente-ia", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              canal: "paciente",
              messages: novoHistorico,
              user_id: config.id_medico,
              paciente_id: paciente?.paciente_id || null,
              paciente_nome: paciente?.name || nomeWhatsapp || null,
              paciente_telefone: telefonePaciente,
            }),
          });
          const res = await handler({ request: fakeRequest } as any);
          const data = (await res.json()) as { reply?: string };
          const reply = (data.reply || "Desculpe, não consegui responder agora. Tente novamente em instantes.").trim();

          await salvarConversa(
            supabaseAdmin,
            config.id_medico,
            telefonePaciente,
            paciente?.paciente_id || null,
            conversa?.id || null,
            [...novoHistorico, { role: "assistant", content: reply }],
          );
          await enviarWhatsApp(phoneNumberId, telefonePaciente, reply);
        } catch (e) {
          console.error("[whatsapp-webhook] Falha ao processar mensagem:", e);
          await enviarWhatsApp(
            phoneNumberId,
            telefonePaciente,
            "Desculpe, tive um problema para responder agora. Tente novamente em instantes.",
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});
