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
    return Response.json(
      { error: err.code, message: err.message },
      { status: err.status },
    );
  }
  // Erros do provedor BRy (HUB/KMS) já trazem status e mensagem tratada.
  if (err && typeof err === "object" && (err as { name?: string }).name === "BryError") {
    const e = err as { message: string; status?: number };
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    console.error("[signature/sign] bry_error", status, e.message);
    return Response.json(
      { error: status === 401 || status === 403 ? "provider_unauthorized" : "provider_unavailable", message: e.message },
      { status },
    );
  }
  console.error("[signature/sign]", err);
  return Response.json({ error: "internal_error", message: String(err) }, { status: 500 });
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const Route = createFileRoute("/api/signature/sign")({
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
            filename?: string;
            certificatePassword?: string;
          };
          if (!body.pdfBase64) {
            return Response.json({ error: "pdf_required" }, { status: 400 });
          }
          const documentId =
            body.documentId ?? `doc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

          const result = await SignatureService.signDocument({
            doctorId: userId,
            documentId,
            pdfBuffer: b64ToBytes(body.pdfBase64),
            contentDescription: body.contentDescription,
            filename: body.filename,
            certificatePassword: body.certificatePassword ?? null,
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});