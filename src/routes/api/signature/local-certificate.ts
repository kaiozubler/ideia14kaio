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
  console.error("[signature/local-certificate]", err);
  return Response.json({ error: "internal_error", message: String(err) }, { status: 500 });
}

const MAX_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3) + 1024;

export const Route = createFileRoute("/api/signature/local-certificate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await getUserIdFromRequest(request);
          if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

          const body = (await request.json()) as {
            fileBase64?: string;
            filename?: string;
            mimeType?: string;
            password?: string;
            label?: string;
          };
          if (!body.fileBase64) return Response.json({ error: "file_required" }, { status: 400 });
          if (body.fileBase64.length > MAX_BASE64) {
            return Response.json({ error: "file_too_large" }, { status: 413 });
          }
          if (!body.password) return Response.json({ error: "password_required" }, { status: 400 });
          if (!/\.(pfx|p12)$/i.test(body.filename ?? "")) {
            return Response.json({ error: "invalid_extension" }, { status: 400 });
          }

          const result = await SignatureService.registerLocalCertificate({
            doctorId: userId,
            fileBase64: body.fileBase64,
            filename: body.filename!,
            mimeType: body.mimeType,
            password: body.password,
            label: body.label,
          });
          return Response.json({ ok: true, certificate: result });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});