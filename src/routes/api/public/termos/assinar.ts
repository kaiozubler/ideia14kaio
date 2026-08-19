import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Assinatura pública de um termo de ciência (link /t/{id}). Autenticação por
// email é sempre obrigatória — o código é validado aqui antes de qualquer
// gravação, igual ao fluxo de formulários (api/public/formularios/responder.ts).
const BodySchema = z.object({
  termo_id: z.string().uuid(),
  paciente_id: z.string().uuid().nullable().optional(),
  nome: z.string().trim().min(3).max(200),
  cpf: z.string().trim().max(20),
  email: z.string().trim().email().max(255),
  checkbox_aceito: z.literal(true),
  codigo: z.string().regex(/^\d{4}$/),
});

const onlyDigits = (v: string | null | undefined) => String(v || "").replace(/\D/g, "");

function formatCpf(digits: string): string {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

// Substitui as variáveis do corpo do termo. É feito no servidor (não confia
// no texto renderizado enviado pelo cliente) porque texto_final é o
// registro legal da assinatura.
function renderCorpo(corpo: string, vars: Record<string, string>): string {
  return corpo.replace(/\{(paciente_nome|paciente_cpf|paciente_email|medico_nome|data_assinatura)\}/g, (_, k) => vars[k] ?? "");
}

export const Route = createFileRoute("/api/public/termos/assinar")({
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
        const body = parsed.data;
        const email = body.email.trim().toLowerCase();
        const cpfDigits = onlyDigits(body.cpf);
        const cpfFormatado = formatCpf(cpfDigits);
        const nome = body.nome.trim();

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: termo, error: termoErr } = await supabaseAdmin
            .from("termos")
            .select("id,ativo,titulo,corpo,checkbox_label,user_id")
            .eq("id", body.termo_id)
            .maybeSingle();
          if (termoErr) throw termoErr;
          if (!termo || !termo.ativo) return Response.json({ error: "termo_unavailable" }, { status: 404 });

          // Valida o código de 4 dígitos (sempre obrigatório para termos).
          const { data: registro, error: codErr } = await supabaseAdmin
            .from("termo_email_codigos")
            .select("id,codigo,tentativas,expira_em,verificado")
            .eq("termo_id", termo.id)
            .eq("email", email)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (codErr) throw codErr;
          if (!registro) return Response.json({ error: "code_required" }, { status: 400 });
          if (registro.tentativas >= 6) return Response.json({ error: "code_blocked" }, { status: 429 });
          if (new Date(registro.expira_em).getTime() < Date.now()) return Response.json({ error: "code_expired" }, { status: 400 });
          if (registro.codigo !== body.codigo) {
            await supabaseAdmin.from("termo_email_codigos").update({ tentativas: registro.tentativas + 1 }).eq("id", registro.id);
            return Response.json({ error: "code_invalid" }, { status: 400 });
          }
          if (!registro.verificado) {
            await supabaseAdmin.from("termo_email_codigos").update({ verificado: true }).eq("id", registro.id);
          }

          // Resolve o nome do médico dono do termo (perfil da conta).
          let medicoNome = "";
          try {
            const { data: userData } = await supabaseAdmin.auth.admin.getUserById(termo.user_id);
            const meta = (userData?.user?.user_metadata || {}) as Record<string, string>;
            medicoNome = meta.full_name || meta.name || userData?.user?.email || "";
          } catch (uErr) {
            console.warn("[termos:assinar] falha ao resolver nome do médico", uErr);
          }

          const dataAssinatura = new Date().toLocaleDateString("pt-BR");
          const textoFinal = renderCorpo(termo.corpo, {
            paciente_nome: nome,
            paciente_cpf: cpfFormatado,
            paciente_email: email,
            medico_nome: medicoNome,
            data_assinatura: dataAssinatura,
          });

          // Localiza (por CPF) ou cria o paciente, igual ao fluxo de formulários,
          // pra vincular a assinatura ao prontuário.
          let pacienteIdResolvido: string | null = body.paciente_id || null;
          if (!pacienteIdResolvido && cpfDigits.length === 11) {
            const { data: existente } = await supabaseAdmin
              .from("pacientes")
              .select("paciente_id")
              .eq("user_id", termo.user_id)
              .eq("cpf", cpfFormatado)
              .maybeSingle();
            if (existente) pacienteIdResolvido = existente.paciente_id;
          }
          if (!pacienteIdResolvido) {
            const { data: novoPaciente, error: novoErr } = await supabaseAdmin
              .from("pacientes")
              .insert({ name: nome, cpf: cpfFormatado, email, user_id: termo.user_id, convenio: "Particular" })
              .select("paciente_id")
              .single();
            if (novoErr) console.warn("[termos:assinar] falha ao criar paciente", novoErr);
            else pacienteIdResolvido = novoPaciente.paciente_id;
          }

          const { data: assinatura, error: aErr } = await supabaseAdmin
            .from("termo_assinaturas")
            .insert({
              termo_id: termo.id,
              paciente_id: pacienteIdResolvido,
              paciente_nome: nome,
              paciente_cpf: cpfDigits,
              paciente_email: email,
              texto_final: textoFinal,
              checkbox_aceito: true,
              email_verificado: true,
            })
            .select("id")
            .single();
          if (aErr) throw aErr;

          if (pacienteIdResolvido) {
            try {
              const now = new Date();
              const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              const { error: consultaErr } = await supabaseAdmin.from("consulta").insert({
                paciente_id: pacienteIdResolvido,
                id_medico: termo.user_id,
                started_at: now.toISOString(),
                ended_at: now.toISOString(),
                title: `Termo assinado — ${termo.titulo}`,
                acao: "Termo de ciência",
                resumo: `Termo "${termo.titulo}" assinado com autenticação por email.`,
                notas: textoFinal,
              });
              if (consultaErr) console.warn("[termos:assinar] falha ao registrar no prontuário", consultaErr);

              const { error: tlErr } = await supabaseAdmin.from("timeline_events").insert({
                paciente_id: pacienteIdResolvido,
                user_id: termo.user_id,
                event_date: now.toLocaleDateString("pt-BR"),
                type: "termo",
                icon: "ti-file-text",
                title: `Termo assinado — ${timeStr}`,
                sub: termo.titulo,
                ref_type: "termo_assinatura",
                ref_id: assinatura.id,
              });
              if (tlErr) console.warn("[termos:assinar] falha ao registrar timeline", tlErr);
            } catch (linkErr) {
              console.warn("[termos:assinar] falha ao vincular ao prontuário/timeline", linkErr);
            }
          }

          try {
            const { sendEmail, termoAssinadoEmailHtml } = await import("@/lib/email/send.server");
            await sendEmail({
              to: email,
              subject: `Cópia do termo assinado — ${termo.titulo}`,
              html: termoAssinadoEmailHtml(termo.titulo, nome, textoFinal),
            });
          } catch (mailErr) {
            console.warn("[termos:assinar] falha ao enviar cópia por email", mailErr);
          }

          return Response.json({ ok: true });
        } catch (err) {
          console.error("[termos:assinar]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
