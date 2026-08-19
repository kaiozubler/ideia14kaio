import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Envia um código de 4 dígitos para o email informado na assinatura pública
// de um termo (/t/{id}). Autenticação por email é sempre obrigatória aqui —
// diferente de questionarios, não existe toggle: todo termo exige o código.
const BodySchema = z.object({
  termo_id: z.string().uuid(),
  email: z.string().trim().email().max(255),
});

export const Route = createFileRoute("/api/public/termos/codigo")({
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
          const { data: termo, error: termoErr } = await supabaseAdmin
            .from("termos")
            .select("id,titulo,ativo")
            .eq("id", parsed.data.termo_id)
            .maybeSingle();
          if (termoErr) throw termoErr;
          if (!termo || !termo.ativo) return Response.json({ error: "termo_unavailable" }, { status: 404 });

          // Anti-abuso: no máximo 5 códigos por email/termo a cada 15 min.
          const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
          const { count } = await supabaseAdmin
            .from("termo_email_codigos")
            .select("id", { count: "exact", head: true })
            .eq("termo_id", termo.id)
            .eq("email", email)
            .gte("created_at", desde);
          if ((count || 0) >= 5) return Response.json({ error: "rate_limited" }, { status: 429 });

          const codigo = String(Math.floor(1000 + Math.random() * 9000));
          const { error: insErr } = await supabaseAdmin.from("termo_email_codigos").insert({
            termo_id: termo.id,
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
              html: codigoEmailHtml(termo.titulo, codigo),
            });
          } catch (mailErr) {
            const motivo = mailErr instanceof Error ? mailErr.message : "email_send_failed";
            return Response.json({ error: motivo }, { status: 502 });
          }

          return Response.json({ ok: true });
        } catch (err) {
          console.error("[termos:codigo]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
