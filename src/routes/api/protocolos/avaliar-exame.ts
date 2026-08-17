import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Avaliação de resultado de exame no motor de protocolos.
// A função de banco é SECURITY DEFINER e não é mais chamável pelo cliente:
// a propriedade do paciente/exame é conferida aqui antes de executá-la.
const BodySchema = z.object({
  exameId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  tussProcedimentoId: z.string().uuid(),
  resultado: z.record(z.string(), z.unknown()),
});

export const Route = createFileRoute("/api/protocolos/avaliar-exame")({
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
        const { exameId, pacienteId, tussProcedimentoId, resultado } = parsed.data;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: exame, error: exErr } = await supabaseAdmin
            .from("exames")
            .select("id,user_id,paciente_id")
            .eq("id", exameId)
            .maybeSingle();
          if (exErr) throw exErr;
          if (!exame || exame.user_id !== userId || exame.paciente_id !== pacienteId) {
            return Response.json({ error: "not_found" }, { status: 404 });
          }

          const { data: pac, error: pacErr } = await supabaseAdmin
            .from("pacientes")
            .select("paciente_id,user_id")
            .eq("paciente_id", pacienteId)
            .maybeSingle();
          if (pacErr) throw pacErr;
          if (!pac || pac.user_id !== userId) return Response.json({ error: "not_found" }, { status: 404 });

          const { data, error } = await supabaseAdmin.rpc("avaliar_resultado_exame", {
            p_exame_id: exameId,
            p_paciente_id: pacienteId,
            p_tuss_procedimento_id: tussProcedimentoId,
            p_resultado: resultado as never,
          });
          if (error) throw error;
          return Response.json({ rows: data || [] });
        } catch (err) {
          console.error("[protocolos:avaliar-exame]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
