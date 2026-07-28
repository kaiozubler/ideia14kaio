import { createFileRoute } from "@tanstack/react-router";
import { SignatureService } from "@/lib/signature/SignatureService";

async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

export const Route = createFileRoute("/api/signature/credential")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        const cred = await SignatureService.getCredential(userId);
        return Response.json({ credential: cred });
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