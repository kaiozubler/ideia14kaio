import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Envia ao paciente o modelo de confirmação de consulta pelo WhatsApp da
 * clínica (atalho/gatilho "Enviar confirmação" do kanban de Atendimentos).
 *
 * Body: { agendamento_id }
 * Quem chama: o médico ou uma secretária ativa da clínica.
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
        // A secretária confirma em nome da clínica (conta do médico); a
        // enfermagem não envia mensagens. Ver clinica_membros.
        const { data: membro } = await (supabaseAdmin as any)
          .from("clinica_membros")
          .select("clinica_id,papel")
          .eq("user_id", userId)
          .eq("status", "ativo")
          .maybeSingle();
        if (membro && membro.papel !== "secretaria") {
          return Response.json(
            { error: "sem_permissao", message: "Seu perfil não envia mensagens aos pacientes." },
            { status: 403 },
          );
        }
        const idClinica = membro ? membro.clinica_id : userId;
        try {
          const r = await enviarConfirmacaoManual(
            supabaseAdmin as any,
            idClinica,
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
