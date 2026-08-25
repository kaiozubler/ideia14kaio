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
  console.error("[signature/a3-externo/prepare]", err);
  return Response.json({ error: "internal_error", message: String(err) }, { status: 500 });
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Fase 1 do A3 externo: monta o placeholder PAdES e devolve o digest
// (SHA-256, base64) que o token/smartcard local deve assinar. Válido por
// 15 minutos (signature_sign_sessions.expires_at) — equivalente ao "tempo
// de vida da requisição" de outras certificadoras, só que sem depender de
// um serviço remoto: o prazo é só para o usuário completar a assinatura
// local antes do PDF intermediário expirar.
export const Route = createFileRoute("/api/signature/a3-externo/prepare")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await getUserIdFromRequest(request);
          if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

          const body = (await request.json()) as {
            documentId?: string;
            pdfBase64?: string;
            contentDescription?: string;
          };
          if (!body.pdfBase64) {
            return Response.json({ error: "pdf_required" }, { status: 400 });
          }
          const documentId =
            body.documentId ?? `doc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

          const result = await SignatureService.prepareA3ExternoSignSession({
            doctorId: userId,
            documentId,
            pdfBuffer: b64ToBytes(body.pdfBase64),
            contentDescription: body.contentDescription,
          });
          return Response.json({ ok: true, ...result, expiresInSeconds: 15 * 60 });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
