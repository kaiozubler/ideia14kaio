import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import { SignatureService } from "@/lib/signature/SignatureService";

// Lista os PSCs (BirdID, Vidaas, SafeID, RemoteID, SerproID, Syn, DS Cloud...)
// que o Integra Bry sabe conversar, para o médico escolher qual usar —
// sem precisar informar UUID nem nenhum dado técnico do certificado.
export const Route = createFileRoute("/api/signature/integra-bry/pscs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        try {
          const pscs = await SignatureService.listIntegraBryPscs();
          return Response.json({ pscs });
        } catch (err) {
          console.error("[signature/integra-bry/pscs]", err);
          const status =
            err &&
            typeof err === "object" &&
            typeof (err as { status?: unknown }).status === "number"
              ? (err as { status: number }).status
              : 502;
          const message =
            err &&
            typeof err === "object" &&
            typeof (err as { message?: unknown }).message === "string"
              ? (err as { message: string }).message
              : "Falha ao consultar o Integra Bry.";
          return Response.json({ pscs: [], error: "provider_unavailable", message }, { status });
        }
      },
    },
  },
});
