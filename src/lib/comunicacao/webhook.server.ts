import { normalizarTelefone, type ConexaoComSegredos } from "./meta.server";
import { obterOuCriarConversa } from "./envio.server";

/**
 * Processa os eventos do webhook da WhatsApp Cloud API de UMA clínica
 * (canal clínica ↔ paciente). Campos assinados no App da Meta:
 *   messages                         mensagens do paciente + status de entrega
 *   message_template_status_update   aprovação/rejeição/pausa de modelos
 *   message_template_quality_update  (opcional) qualidade dos modelos
 *   phone_number_quality_update      (opcional) qualidade/limite do número
 *
 * Aqui NÃO há resposta automática por IA: este canal é atendido por pessoas
 * na tela Conversas (o autoatendimento por IA continua no whatsapp-webhook.ts).
 */

// deno-lint-ignore no-explicit-any
type Db = any;

const ORDEM_STATUS: Record<string, number> = {
  enviando: 0,
  enviada: 1,
  entregue: 2,
  lida: 3,
  falhou: 4,
};
const STATUS_META: Record<string, string> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
};
/** Reentregas muito atrasadas da Meta não devem "reabrir" a janela de 24h nem gerar não-lidas. */
const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;

export async function verificarAssinatura(
  appSecret: string,
  assinatura: string | null,
  corpo: string,
) {
  if (!assinatura) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(corpo));
  const esperado =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  if (assinatura.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++)
    diff |= assinatura.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

function conteudoDaMensagem(msg: any): { tipo: string; texto: string; midia: any } {
  const t = msg?.type || "unknown";
  switch (t) {
    case "text":
      return { tipo: "text", texto: msg.text?.body || "", midia: null };
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const m = msg[t] || {};
      const rotulo: Record<string, string> = {
        image: "📷 Foto",
        video: "🎬 Vídeo",
        audio: "🎤 Áudio",
        document: "📄 Documento",
        sticker: "Figurinha",
      };
      return {
        tipo: t,
        texto: m.caption || (t === "document" ? m.filename || rotulo[t] : rotulo[t]),
        midia: {
          id: m.id,
          mime_type: m.mime_type,
          filename: m.filename || null,
          caption: m.caption || null,
          voice: !!m.voice,
        },
      };
    }
    case "location": {
      const l = msg.location || {};
      return {
        tipo: "location",
        texto: `📍 ${l.name || l.address || "Localização"} (${l.latitude}, ${l.longitude})`,
        midia: { latitude: l.latitude, longitude: l.longitude, name: l.name, address: l.address },
      };
    }
    case "button":
      return { tipo: "button", texto: msg.button?.text || msg.button?.payload || "", midia: null };
    case "interactive": {
      const i = msg.interactive || {};
      const r = i.button_reply || i.list_reply || {};
      return { tipo: "interactive", texto: r.title || "", midia: null };
    }
    case "reaction":
      return { tipo: "reaction", texto: `Reagiu ${msg.reaction?.emoji || ""}`.trim(), midia: null };
    case "contacts":
      return {
        tipo: "contacts",
        texto: `👤 Contato: ${msg.contacts?.[0]?.name?.formatted_name || ""}`,
        midia: null,
      };
    default:
      return { tipo: t, texto: "[Mensagem não suportada pelo WhatsApp Cloud API]", midia: null };
  }
}

async function processarMensagem(db: Db, c: ConexaoComSegredos, value: any, msg: any) {
  const telefone = normalizarTelefone(msg.from);
  if (!telefone) return;
  const ts = Number(msg.timestamp) * 1000;
  const recebidaEm = Number.isFinite(ts) ? new Date(ts) : new Date();
  const antiga = Date.now() - recebidaEm.getTime() > IDADE_MAXIMA_MS;

  const contato =
    (value.contacts || []).find((x: any) => normalizarTelefone(x.wa_id) === telefone) ||
    value.contacts?.[0];
  const conversa = await obterOuCriarConversa(db, c.id_medico, telefone, {
    nomeContato: contato?.profile?.name || null,
  });
  const { tipo, texto, midia } = conteudoDaMensagem(msg);

  // Idempotência: wa_message_id é único; reentrega da Meta não duplica nem soma não-lidas.
  const { data: inserida, error } = await db
    .from("comunicacao_whatsapp_mensagens")
    .upsert(
      {
        conversa_id: conversa.id,
        id_medico: c.id_medico,
        direcao: "entrada",
        tipo,
        conteudo: texto,
        midia,
        wa_message_id: msg.id,
        status: "recebida",
        criada_em: recebidaEm.toISOString(),
      },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error("[whatsapp-clinica] falha ao gravar mensagem recebida:", error.message);
    return;
  }
  if (!inserida || inserida.length === 0 || antiga) return;

  const upd: Record<string, unknown> = {
    ultima_mensagem: texto.slice(0, 280),
    ultima_mensagem_em: recebidaEm.toISOString(),
    ultima_entrada_em: recebidaEm.toISOString(),
    nao_lidas: (conversa.nao_lidas || 0) + 1,
    status: "aberta",
  };
  if (!conversa.nome_contato && contato?.profile?.name) upd.nome_contato = contato.profile.name;
  await db.from("comunicacao_whatsapp_conversas").update(upd).eq("id", conversa.id);
}

async function processarStatus(db: Db, c: ConexaoComSegredos, st: any) {
  const novo = STATUS_META[st.status];
  if (!novo || !st.id) return;
  const { data: msg } = await db
    .from("comunicacao_whatsapp_mensagens")
    .select("id,status")
    .eq("wa_message_id", st.id)
    .eq("id_medico", c.id_medico)
    .maybeSingle();
  if (!msg) return;
  // Os eventos podem chegar fora de ordem (read antes de delivered): nunca regride.
  if (novo !== "falhou" && (ORDEM_STATUS[msg.status] ?? 0) >= ORDEM_STATUS[novo]) return;
  const erro = st.errors?.[0];
  await db
    .from("comunicacao_whatsapp_mensagens")
    .update({
      status: novo,
      status_em: st.timestamp
        ? new Date(Number(st.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
      ...(erro
        ? { erro: [erro.code, erro.title, erro.error_data?.details].filter(Boolean).join(" — ") }
        : {}),
    })
    .eq("id", msg.id);
}

async function processarModelo(db: Db, c: ConexaoComSegredos, v: any) {
  if (!v?.message_template_id) return;
  const upd: Record<string, unknown> = { sincronizado_em: new Date().toISOString() };
  if (v.event) {
    const ev = String(v.event).toUpperCase();
    upd.status = ev === "FLAGGED" ? "PAUSED" : ev === "REINSTATED" ? "APPROVED" : ev;
    upd.motivo_rejeicao = v.reason && v.reason !== "NONE" ? v.reason : null;
  }
  const permitido = [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "PAUSED",
    "DISABLED",
    "IN_APPEAL",
    "PENDING_DELETION",
    "DELETED",
    "LIMIT_EXCEEDED",
    "ARCHIVED",
  ];
  if (upd.status && !permitido.includes(upd.status as string)) delete upd.status;
  await db
    .from("comunicacao_whatsapp_modelos")
    .update(upd)
    .eq("id_medico", c.id_medico)
    .eq("meta_template_id", String(v.message_template_id));
}

export async function processarEventos(db: Db, c: ConexaoComSegredos, body: any) {
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const v = change?.value || {};
      try {
        if (change.field === "messages") {
          // Eventos de outro número da mesma WABA não são desta conexão.
          if (
            v.metadata?.phone_number_id &&
            c.phone_number_id &&
            v.metadata.phone_number_id !== c.phone_number_id
          )
            continue;
          for (const msg of v.messages || []) await processarMensagem(db, c, v, msg);
          for (const st of v.statuses || []) await processarStatus(db, c, st);
        } else if (change.field === "message_template_status_update") {
          await processarModelo(db, c, v);
        } else if (change.field === "phone_number_quality_update") {
          const upd: Record<string, unknown> = {};
          if (v.current_limit) upd.messaging_limit_tier = v.current_limit;
          if (v.event)
            upd.quality_rating =
              v.event === "DOWNGRADE" ? "YELLOW" : v.event === "FLAGGED" ? "RED" : "GREEN";
          if (Object.keys(upd).length)
            await db.from("comunicacao_whatsapp_conexoes").update(upd).eq("id_medico", c.id_medico);
        }
      } catch (e) {
        console.error("[whatsapp-clinica] falha ao processar evento", change?.field, e);
      }
    }
  }
  await db
    .from("comunicacao_whatsapp_conexoes")
    .update({ ultimo_evento_em: new Date().toISOString() })
    .eq("id_medico", c.id_medico);
}
