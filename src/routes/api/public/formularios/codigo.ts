import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Envia um código de 4 dígitos para o email informado no formulário público
// (/f/{id}) quando o formulário exige autenticação por email.
const BodySchema = z.object({
  questionario_id: z.string().uuid(),
  email: z.string().trim().email().max(255),
});

export const Route = createFileRoute("/api/public/formularios/codigo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
        const email = parsed.data.email.toLowerCase();

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: form, error: formErr } = await supabaseAdmin
            .from("questionarios")
            .select("id,titulo,ativo,exigir_auth_email")
            .eq("id", parsed.data.questionario_id)
            .maybeSingle();
          if (formErr) throw formErr;
          if (!form || !form.ativo) return Response.json({ error: "form_unavailable" }, { status: 404 });
          if (!form.exigir_auth_email) return Response.json({ error: "auth_not_required" }, { status: 400 });

          // Anti-abuso: no máximo 5 códigos por email/formulário a cada 15 min.
          const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
          const { count } = await supabaseAdmin
            .from("questionario_email_codigos")
            .select("id", { count: "exact", head: true })
            .eq("questionario_id", form.id)
            .eq("email", email)
            .gte("created_at", desde);
          if ((count || 0) >= 5) return Response.json({ error: "rate_limited" }, { status: 429 });

          const codigo = String(Math.floor(1000 + Math.random() * 9000));
          const { error: insErr } = await supabaseAdmin.from("questionario_email_codigos").insert({
            questionario_id: form.id,
            email,
            codigo,
            expira_em: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          });
          if (insErr) throw insErr;

          const { sendEmail, codigoEmailHtml } = await import("@/lib/email/send.server");
          try {
            await sendEmail({
              to: email,
              subject: `Seu código de confirmação: ${codigo}`,
              html: codigoEmailHtml(form.titulo, codigo),
            });
          } catch (mailErr) {
            const motivo = mailErr instanceof Error ? mailErr.message : "email_send_failed";
            return Response.json({ error: motivo }, { status: 502 });
          }

          return Response.json({ ok: true });
        } catch (err) {
          console.error("[formularios:codigo]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
