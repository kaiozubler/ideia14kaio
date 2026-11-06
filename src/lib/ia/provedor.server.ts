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

export const GEMINI_MODEL = "google/gemini-3.8-flash";
/** ID anterior, usado só se o gateway recusar o atual (ver chamarGemini). */
const GEMINI_MODEL_RESERVA = "google/gemini-3.6-flash";
export const CLAUDE_MODEL = "claude-sonnet-5-5";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type ProvedorIA = "gemini" | "claude";
export type Esforco = "low" | "medium" | "high";
export type MensagemIA = { role: "system" | "user" | "assistant"; content: string };

export function provedorDoUsuario(meta: Record<string, unknown> | null | undefined): ProvedorIA {
  return meta?.ia_analise === "claude" ? "claude" : "gemini";
}

async function chamarGemini(messages: MensagemIA[], apiKey: string, esforco?: Esforco) {
  const enviar = (model: string, extra: Record<string, unknown>) =>
    fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({ model, messages, ...extra }),
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
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

let clienteAnthropic: Anthropic | null = null;
function anthropic() {
  if (!clienteAnthropic) clienteAnthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return clienteAnthropic;
}

async function chamarClaude(messages: MensagemIA[], esforco: Esforco) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const conversa = messages
    .filter((m): m is MensagemIA & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  try {
    const resposta = await anthropic().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: system || undefined,
      messages: conversa,
      output_config: { effort: esforco },
      // Se o filtro de segurança recusar (ex.: termos médicos sensíveis), a própria
      // API refaz a chamada no modelo de reserva indicado pela Anthropic.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (resposta.stop_reason === "refusal") {
      throw new Response("A IA recusou esta solicitação. Reformule ou tente com o Gemini.", {
        status: 422,
      });
    }
    return resposta.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    if (err instanceof Response) throw err;
    if (err instanceof Anthropic.APIError) {
      throw new Response(`Claude API error ${err.status ?? ""}: ${err.message}`, {
        status: err.status && err.status >= 400 ? err.status : 502,
      });
    }
    throw err;
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
