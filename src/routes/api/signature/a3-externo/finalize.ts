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
  console.error("[signature/a3-externo/finalize]", err);
  return Response.json({ error: "internal_error", message: String(err) }, { status: 500 });
}

// Fase 2 do A3 externo: recebe o CMS/PKCS#7 (base64) já produzido pelo
// driver do token/smartcard no navegador a partir do digest devolvido por
// /prepare, espeta a assinatura no PDF e sobe para o Storage — mesmo
// destino final de signDocument() para os demais providers.
export const Route = createFileRoute("/api/signature/a3-externo/finalize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await getUserIdFromRequest(request);
          if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

          const body = (await request.json()) as {
            signSessionId?: string;
            cmsBase64?: string;
            filename?: string;
          };
          if (!body.signSessionId || !body.cmsBase64) {
            return Response.json({ error: "sign_session_and_cms_required" }, { status: 400 });
          }

          const result = await SignatureService.finalizeA3ExternoSignature({
            doctorId: userId,
            signSessionId: body.signSessionId,
            cmsBase64: body.cmsBase64,
            filename: body.filename,
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
