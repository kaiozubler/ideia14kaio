import { createFileRoute } from "@tanstack/react-router";
import { SignatureService } from "@/lib/signature/SignatureService";
import { SignatureError } from "@/lib/signature/errors";

async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

function errorResponse(err: unknown) {
  if (err instanceof SignatureError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error("[signature/integra-bry/callback]", err);
  return Response.json({ error: "internal_error", message: String(err) }, { status: 500 });
}

// Chamado pelo frontend depois que o PSC redireciona de volta para
// `redirectUri` (enviado em /integra-bry/link) com `?state=...` na URL.
// Confirma a sessão e devolve os dados do certificado escolhido.
export const Route = createFileRoute("/api/signature/integra-bry/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await getUserIdFromRequest(request);
          if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

          const body = (await request.json()) as { state?: string; apiKey?: string };
          if (!body.state) return Response.json({ error: "state_required" }, { status: 400 });

          const result = await SignatureService.completeIntegraBryLink({
            state: body.state,
            apiKeyFromCallback: body.apiKey ?? null,
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
