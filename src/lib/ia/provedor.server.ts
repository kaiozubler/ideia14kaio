// Escolha do modelo que gera as análises e respostas ao médico (/api/chat-ia).
//
// O médico escolhe em Minhas IAs › Copiloto de consulta; a escolha fica em
// user_metadata.ia_analise ("gemini" | "claude") e é lida aqui a partir do
// usuário do token, nunca do corpo da requisição.
//
// - Gemini: pelo gateway da Lovable (LOVABLE_API_KEY).
// - Claude: direto na API da Anthropic (ANTHROPIC_API_KEY), com o SDK oficial.
//   Sem a chave configurada, a chamada volta para o Gemini (com aviso no log)
//   em vez de derrubar o atendimento.
import Anthropic from "@anthropic-ai/sdk";
import { lerStreamGateway } from "./stream.server";

export const GEMINI_MODEL = "google/gemini-3.8-flash";
/** ID anterior, usado só se o gateway recusar o atual (ver chamarGemini). */
const GEMINI_MODEL_RESERVA = "google/gemini-3.6-flash";
export const CLAUDE_MODEL = "claude-sonnet-5-5";
/** Voz das respostas (/api/ia/fala), pelo mesmo gateway em /v1/audio/speech. */
export const GEMINI_TTS_MODEL = "google/gemini-2.5-flash-tts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type ProvedorIA = "gemini" | "claude";
export type Esforco = "low" | "medium" | "high";
export type MensagemIA = { role: "system" | "user" | "assistant"; content: string };

export function provedorDoUsuario(meta: Record<string, unknown> | null | undefined): ProvedorIA {
  return meta?.ia_analise === "claude" ? "claude" : "gemini";
}

/** Abre a chamada ao Gemini (com as tentativas de reserva) e devolve a resposta ok. */
async function respostaGemini(messages: MensagemIA[], apiKey: string, esforco?: Esforco, stream = false) {
  const enviar = (model: string, extra: Record<string, unknown>) =>
    fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({ model, messages, ...(stream ? { stream: true } : {}), ...extra }),
    });
  const extra = esforco ? { reasoning_effort: esforco } : {};
  let res = await enviar(GEMINI_MODEL, extra);
  // 400/404 aqui costuma ser parâmetro ou ID de modelo não aceito pelo gateway:
  // tenta de novo sem o raciocínio e, se ainda falhar, com o ID anterior,
  // para nunca derrubar o copiloto por causa disso.
  if (res.status === 400 || res.status === 404) {
    console.warn("[ia] gateway recusou a chamada:", res.status, await res.text());
    res = await enviar(GEMINI_MODEL, {});
    if (res.status === 400 || res.status === 404) {
      console.warn("[ia] gateway recusou", GEMINI_MODEL, "— usando", GEMINI_MODEL_RESERVA);
      res = await enviar(GEMINI_MODEL_RESERVA, {});
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Response(`AI gateway error ${res.status}: ${text}`, { status: res.status });
  }
  return res;
}

async function chamarGemini(messages: MensagemIA[], apiKey: string, esforco?: Esforco) {
  const res = await respostaGemini(messages, apiKey, esforco);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * POST direto no gateway (para rotas que montam o próprio corpo, ex.: tool-calling
 * do assistente). Pede `esforco` de raciocínio e, se o gateway recusar o parâmetro
 * (400), refaz sem ele — o Gemini "pensa" bastante por padrão, e é isso que mais
 * pesa no tempo de resposta.
 */
export async function fetchGateway(
  apiKey: string,
  corpo: Record<string, unknown>,
  esforco?: Esforco,
): Promise<Response> {
  const enviar = (extra: Record<string, unknown>) =>
    fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({ ...corpo, ...extra }),
    });
  if (!esforco) return enviar({});
  const res = await enviar({ reasoning_effort: esforco });
  if (res.status !== 400) return res;
  console.warn("[ia] gateway recusou reasoning_effort:", await res.text());
  return enviar({});
}

let clienteAnthropic: Anthropic | null = null;
function anthropic() {
  if (!clienteAnthropic) clienteAnthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return clienteAnthropic;
}

function paramsClaude(messages: MensagemIA[], esforco: Esforco) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const conversa = messages
    .filter((m): m is MensagemIA & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: system || undefined,
    messages: conversa,
    output_config: { effort: esforco },
    // Se o filtro de segurança recusar (ex.: termos médicos sensíveis), a própria
    // API refaz a chamada no modelo de reserva indicado pela Anthropic.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };
}

function erroClaude(err: unknown): never {
  if (err instanceof Response) throw err;
  if (err instanceof Anthropic.APIError) {
    throw new Response(`Claude API error ${err.status ?? ""}: ${err.message}`, {
      status: err.status && err.status >= 400 ? err.status : 502,
    });
  }
  throw err;
}

function textoClaude(resposta: Anthropic.Beta.BetaMessage) {
  if (resposta.stop_reason === "refusal") {
    throw new Response("A IA recusou esta solicitação. Reformule ou tente com o Gemini.", {
      status: 422,
    });
  }
  return resposta.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

async function chamarClaude(messages: MensagemIA[], esforco: Esforco) {
  try {
    return textoClaude(await anthropic().beta.messages.create(paramsClaude(messages, esforco)));
  } catch (err) {
    erroClaude(err);
  }
}

async function chamarClaudeStream(messages: MensagemIA[], esforco: Esforco, aoTexto: (delta: string) => void) {
  try {
    const stream = anthropic().beta.messages.stream(paramsClaude(messages, esforco));
    stream.on("text", (delta) => aoTexto(delta));
    return textoClaude(await stream.finalMessage());
  } catch (err) {
    erroClaude(err);
  }
}

/**
 * Chama o modelo escolhido pelo médico. `esforco` controla quanto o modelo
 * "pensa" antes de responder (tokens de raciocínio são cobrados como saída).
 */
export async function chamarIA(
  provedor: ProvedorIA,
  messages: MensagemIA[],
  lovableKey: string,
  esforco: Esforco = "medium",
): Promise<string> {
  if (provedor === "claude") {
    if (process.env.ANTHROPIC_API_KEY) return chamarClaude(messages, esforco);
    console.warn("[ia] Claude escolhido, mas ANTHROPIC_API_KEY não está configurada — usando Gemini");
  }
  return chamarGemini(messages, lovableKey, esforco);
}

/**
 * Igual a `chamarIA`, mas chama `aoTexto` a cada pedaço da resposta enquanto o
 * modelo escreve. Devolve o texto completo no fim.
 */
export async function chamarIAStream(
  provedor: ProvedorIA,
  messages: MensagemIA[],
  lovableKey: string,
  esforco: Esforco,
  aoTexto: (delta: string) => void,
): Promise<string> {
  if (provedor === "claude") {
    if (process.env.ANTHROPIC_API_KEY) return chamarClaudeStream(messages, esforco, aoTexto);
    console.warn("[ia] Claude escolhido, mas ANTHROPIC_API_KEY não está configurada — usando Gemini");
  }
  const res = await respostaGemini(messages, lovableKey, esforco, true);
  const mensagem = await lerStreamGateway(res, aoTexto);
  return String(mensagem.content ?? "");
}
