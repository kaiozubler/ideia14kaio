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
      { error: err.code, message: err.message, details: err.details },
      { status: err.status },
    );
  }
  console.error("[signature/authenticate]", err);
  return Response.json({ error: "internal_error", message: String(err) }, { status: 500 });
}

export const Route = createFileRoute("/api/signature/authenticate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await getUserIdFromRequest(request);
          if (!userId) {
            return Response.json({ error: "unauthorized" }, { status: 401 });
          }
          const body = (await request.json()) as {
            doctorId?: string;
            cpf?: string;
            callbackUrl?: string;
          };
          const cpf = (body.cpf ?? "").replace(/\D/g, "");
          if (cpf.length !== 11) {
            return Response.json({ error: "invalid_cpf" }, { status: 400 });
          }
          if (!body.callbackUrl) {
            return Response.json({ error: "callback_url_required" }, { status: 400 });
          }
          const doctorId = body.doctorId && body.doctorId === userId ? userId : userId;

          const result = await SignatureService.authenticate({
            doctorId,
            cpf,
            callbackUrl: body.callbackUrl,
          });
          return Response.json(result);
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});