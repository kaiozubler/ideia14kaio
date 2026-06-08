import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type RequestBody = {
  mode?: "chat" | "resumo";
  messages?: ChatMessage[];
  resumo_prontuario?: string;
  paciente?: Record<string, unknown>;
  atendimentos?: unknown[];
  exames?: unknown[];
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