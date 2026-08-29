import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import { SignatureService } from "@/lib/signature/SignatureService";
import { SignatureError, errorMessage } from "@/lib/signature/errors";

function errorResponse(err: unknown) {
  if (err instanceof SignatureError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  if (err && typeof err === "object" && (err as { name?: string }).name === "BryError") {
    const e = err as { message: string; status?: number };
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    console.error("[signature/integra-bry/sign] bry_error", status, e.message);
    return Response.json({ error: "provider_unavailable", message: e.message }, { status });
  }
  console.error("[signature/integra-bry/sign]", err);
  return Response.json({ error: "internal_error", message: errorMessage(err) }, { status: 500 });
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const Route = createFileRoute("/api/signature/integra-bry/sign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await getUserIdFromRequest(request);
          if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

          const body = (await request.json()) as {
            sessionId?: string;
            pdfBase64?: string;
            contentDescription?: string;
            filename?: string;
          };
          if (!body.sessionId || !body.pdfBase64) {
            return Response.json({ error: "session_id_and_pdf_required" }, { status: 400 });
          }

          const result = await SignatureService.signWithIntegraBry({
            doctorId: userId,
            sessionId: body.sessionId,
            pdfBuffer: b64ToBytes(body.pdfBase64),
            contentDescription: body.contentDescription,
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
