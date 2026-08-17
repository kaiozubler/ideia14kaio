import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Envio público de respostas de formulário (link /f/{id}).
// Toda a gravação acontece aqui no servidor: o cliente anônimo não tem
// permissão de escrita nas tabelas de respostas, o que impede injetar itens
// em respostas de outros pacientes.
const ItemSchema = z.object({
  pergunta_id: z.string().uuid(),
  valor_texto: z.string().max(4000).nullable().optional(),
  valor_opcoes: z.array(z.string().max(300)).max(50).nullable().optional(),
  valor_escala: z.number().int().min(0).max(100).nullable().optional(),
});

const BodySchema = z.object({
  questionario_id: z.string().uuid(),
  paciente_id: z.string().uuid().nullable().optional(),
  paciente_nome: z.string().trim().max(120).optional(),
  paciente_telefone: z.string().trim().max(20).optional(),
  paciente_email: z.string().trim().email().max(160).nullable().optional(),
  paciente_cpf: z.string().trim().max(11).nullable().optional(),
  itens: z.array(ItemSchema).max(200),
});

export const Route = createFileRoute("/api/public/formularios/responder")({
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

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: form, error: formErr } = await supabaseAdmin
            .from("questionarios")
            .select("id,ativo,anonimo")
            .eq("id", body.questionario_id)
            .maybeSingle();
          if (formErr) throw formErr;
          if (!form || !form.ativo) return Response.json({ error: "form_unavailable" }, { status: 404 });

          // Só aceita itens de perguntas que pertencem a este formulário.
          const { data: perguntas, error: pErr } = await supabaseAdmin
            .from("questionario_perguntas")
            .select("id")
            .eq("questionario_id", form.id);
          if (pErr) throw pErr;
          const validas = new Set((perguntas || []).map((p) => p.id));
          const itens = body.itens.filter((i) => validas.has(i.pergunta_id));

          const identificacao = form.anonimo
            ? {}
            : {
                paciente_id: body.paciente_id || null,
                paciente_nome: body.paciente_nome || null,
                paciente_telefone: body.paciente_telefone || null,
                paciente_email: body.paciente_email || null,
                paciente_cpf: body.paciente_cpf || null,
              };

          const { data: resp, error: rErr } = await supabaseAdmin
            .from("questionario_respostas")
            .insert({ questionario_id: form.id, ...identificacao })
            .select("id")
            .single();
          if (rErr) throw rErr;

          if (itens.length) {
            const { error: iErr } = await supabaseAdmin.from("questionario_resposta_itens").insert(
              itens.map((i) => ({
                resposta_id: resp.id,
                pergunta_id: i.pergunta_id,
                valor_texto: i.valor_texto ?? null,
                valor_opcoes: i.valor_opcoes ?? null,
                valor_escala: i.valor_escala ?? null,
              })),
            );
            if (iErr) throw iErr;
          }

          return Response.json({ ok: true });
        } catch (err) {
          console.error("[formularios:responder]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
