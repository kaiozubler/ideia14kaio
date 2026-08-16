import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { issueDeepgramToken } from "@/routes/api/deepgram-token";

// A extensão de navegador roda em outra origem (a página que o médico está vendo),
// por isso este endpoint precisa de CORS e valida o usuário pelo próprio token do
// app — mesmo padrão usado em /api/public/extensao/chat. A emissão do token do
// Deepgram em si é idêntica à usada pelo app principal (issueDeepgramToken).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export const Route = createFileRoute("/api/public/extensao/deepgram-token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const userId = await userIdFromBearer(request);
        if (!userId) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
        }
        const res = await issueDeepgramToken();
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
        return new Response(res.body, { status: res.status, headers });
      },
    },
  },
});
