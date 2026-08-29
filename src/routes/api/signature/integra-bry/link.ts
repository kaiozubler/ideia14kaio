import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import { SignatureService } from "@/lib/signature/SignatureService";
import { SignatureError, errorMessage } from "@/lib/signature/errors";

function errorResponse(err: unknown) {
  if (err instanceof SignatureError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error("[signature/integra-bry/link]", err);
  return Response.json({ error: "internal_error", message: errorMessage(err) }, { status: 500 });
}

// A3 externo (certificado hospedado por OUTRO PSC, não pela BRy) via
// Integra Bry. Gera o link de autenticação — o frontend deve abrir
// `authorizationUrl` (nova aba ou redirect) para o médico autenticar no
// PSC escolhido e selecionar o certificado.
export const Route = createFileRoute("/api/signature/integra-bry/link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await getUserIdFromRequest(request);
          if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

          const body = (await request.json()) as {
            pscName?: string;
            cpf?: string;
            redirectUri?: string;
            scope?: "single_signature" | "multi_signature" | "signature_session";
            lifetimeSeconds?: number;
          };
          if (!body.pscName || !body.redirectUri) {
            return Response.json({ error: "psc_name_and_redirect_uri_required" }, { status: 400 });
          }
          const cpf = body.cpf ? body.cpf.replace(/\D/g, "") : undefined;

          const result = await SignatureService.startIntegraBryLink({
            doctorId: userId,
            pscName: body.pscName,
            redirectUri: body.redirectUri,
            cpf,
            scope: body.scope,
            lifetimeSeconds: body.lifetimeSeconds,
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
