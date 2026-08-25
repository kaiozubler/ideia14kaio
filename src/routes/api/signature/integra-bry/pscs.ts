import { createFileRoute } from "@tanstack/react-router";
import { SignatureService } from "@/lib/signature/SignatureService";

async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

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
          return Response.json({ pscs: [], error: "internal_error" }, { status: 200 });
        }
      },
    },
  },
});
