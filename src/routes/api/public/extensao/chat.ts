import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { handleAssistente, type RequestBody } from "@/routes/api/assistente-ia";

// A extensão de navegador roda em outra origem (a página que o médico está vendo),
// por isso o endpoint precisa de CORS e valida o usuário pelo próprio token do app.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

async function userIdFromBearer(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export const Route = createFileRoute("/api/public/extensao/chat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const userId = await userIdFromBearer(request);
        if (!userId) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
        }

        let raw: Record<string, unknown>;
        try {
          raw = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400, headers: CORS });
        }

        const mensagens = Array.isArray(raw.messages) ? (raw.messages as RequestBody["messages"]) : [];
        const body: RequestBody = {
          canal: "interno",
          // A identidade vem SEMPRE do token validado, nunca do corpo da requisição.
          user_id: userId,
          conversa_id: typeof raw.conversa_id === "string" ? raw.conversa_id : null,
          messages: mensagens,
          contexto_tela: typeof raw.contexto_tela === "string" ? raw.contexto_tela.slice(0, 20000) : null,
        };

        const res = await handleAssistente(body);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
        return new Response(res.body, { status: res.status, headers });
      },
    },
  },
});
