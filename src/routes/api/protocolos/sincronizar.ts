import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ protocoloId: z.string().uuid() });

export const Route = createFileRoute("/api/protocolos/sincronizar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: prot, error: protErr } = await supabaseAdmin
            .from("protocolos")
            .select("id,user_id")
            .eq("id", parsed.data.protocoloId)
            .maybeSingle();
          if (protErr) throw protErr;
          if (!prot || prot.user_id !== userId) {
            return Response.json({ error: "not_found" }, { status: 404 });
          }

          const { error } = await supabaseAdmin.rpc("sincronizar_protocolo", {
            p_protocolo_id: parsed.data.protocoloId,
          });
          if (error) throw error;
          return Response.json({ ok: true });
        } catch (err) {
          console.error("[protocolos:sincronizar]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});