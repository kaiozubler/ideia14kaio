import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import { SignatureService } from "@/lib/signature/SignatureService";
import { SignatureError, errorMessage } from "@/lib/signature/errors";

function errorResponse(err: unknown) {
  if (err instanceof SignatureError) {
    return Response.json(
      { error: err.code, message: err.message, details: err.details },
      { status: err.status },
    );
  }
  console.error("[signature/authenticate]", err);
  return Response.json({ error: "internal_error", message: errorMessage(err) }, { status: 500 });
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
            provider?: string;
            uuidCert?: string | null;
            label?: string | null;
            holderName?: string | null;
            /** Só usado quando provider = "bry_cloud": "a1" (padrão) ou "a3". */
            certificateType?: "a1" | "a3";
          };
          const cpf = (body.cpf ?? "").replace(/\D/g, "");
          if (cpf.length !== 11) {
            return Response.json({ error: "invalid_cpf" }, { status: 400 });
          }
          const provider = body.provider ?? "bry_cloud";

          if (provider === "bry_cloud") {
            const result = await SignatureService.registerBryCloudCertificate({
              doctorId: userId,
              cpf,
              uuidCert: body.uuidCert ?? null,
              label: body.label ?? null,
              holderName: body.holderName ?? null,
              certificateType: body.certificateType ?? "a1",
            });
            return Response.json(result);
          }

          if (!body.callbackUrl) {
            return Response.json({ error: "callback_url_required" }, { status: 400 });
          }
          const result = await SignatureService.authenticate({
            doctorId: userId,
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
