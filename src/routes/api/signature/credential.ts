import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SignatureService } from "@/lib/signature/SignatureService";

// Token validation only needs the publishable key — avoids depending on the
// service-role key just to identify the caller.
async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

export const Route = createFileRoute("/api/signature/credential")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        try {
          const cred = await SignatureService.getCredential(userId);
          return Response.json({ credential: cred });
        } catch (err) {
          console.error("[signature/credential:GET]", err);
          return Response.json(
            { credential: null, error: err instanceof Error ? err.message : "internal_error" },
            { status: 200 },
          );
        }
      },
      DELETE: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        try {
          const result = await SignatureService.removeCredential(userId);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[signature/credential:DELETE]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});