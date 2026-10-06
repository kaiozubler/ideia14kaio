import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Envia ao paciente o modelo de confirmação de consulta pelo WhatsApp da
 * clínica (atalho/gatilho "Enviar confirmação" do kanban de Atendimentos).
 *
 * Body: { agendamento_id }
 * Resposta: { ok: true, ja_enviado } — ja_enviado quando a confirmação
 * automática (ou um clique anterior) já tinha saído.
 */
export const Route = createFileRoute("/api/comunicacao/confirmar-agendamento")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: { agendamento_id?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        if (!body.agendamento_id) {
          return Response.json({ error: "agendamento_obrigatorio" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { respostaDeErro } = await import("@/lib/comunicacao/envio.server");
        const { enviarConfirmacaoManual } = await import("@/lib/comunicacao/lembretes.server");
        try {
          const r = await enviarConfirmacaoManual(
            supabaseAdmin as any,
            userId,
            body.agendamento_id,
          );
          return Response.json({ ok: true, ja_enviado: r.jaEnviado });
        } catch (e) {
          return respostaDeErro(e);
        }
      },
    },
  },
});
