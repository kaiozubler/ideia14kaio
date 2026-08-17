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

const onlyDigits = (v: string | null | undefined) => String(v || "").replace(/\D/g, "");

function formatCpf(digits: string): string {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

type PerguntaRef = {
  id: string;
  enunciado: string;
  tipo: "texto" | "unica" | "multipla" | "escala";
  escala_label_min: string | null;
  escala_label_max: string | null;
};

type ItemGravado = {
  pergunta_id: string;
  valor_texto: string | null;
  valor_opcoes: string[] | null;
  valor_escala: number | null;
};

// Transforma as respostas — qualquer que seja o tipo de pergunta — num texto
// corrido legível, pra registrar no prontuário (campo "notas" de consulta).
function flattenRespostas(perguntas: PerguntaRef[], itens: ItemGravado[]): string {
  const porId = new Map(perguntas.map((p) => [p.id, p]));
  const linhas = itens
    .map((it) => {
      const p = porId.get(it.pergunta_id);
      if (!p) return null;
      let valor = "—";
      if (p.tipo === "escala") {
        valor = it.valor_escala != null ? String(it.valor_escala) : "—";
      } else if (p.tipo === "unica" || p.tipo === "multipla") {
        valor = it.valor_opcoes && it.valor_opcoes.length ? it.valor_opcoes.join(", ") : "—";
      } else {
        valor = it.valor_texto && it.valor_texto.trim() ? it.valor_texto.trim() : "—";
      }
      return `${p.enunciado}\n${valor}`;
    })
    .filter(Boolean);
  return linhas.join("\n\n");
}

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
            .select("id,ativo,anonimo,titulo,user_id")
            .eq("id", body.questionario_id)
            .maybeSingle();
          if (formErr) throw formErr;
          if (!form || !form.ativo) return Response.json({ error: "form_unavailable" }, { status: 404 });

          // Só aceita itens de perguntas que pertencem a este formulário.
          const { data: perguntas, error: pErr } = await supabaseAdmin
            .from("questionario_perguntas")
            .select("id,enunciado,tipo,escala_label_min,escala_label_max")
            .eq("questionario_id", form.id);
          if (pErr) throw pErr;
          const perguntasRef = (perguntas || []) as PerguntaRef[];
          const validas = new Set(perguntasRef.map((p) => p.id));
          const itens = body.itens.filter((i) => validas.has(i.pergunta_id));

          // Cruza o CPF informado com os pacientes já cadastrados deste médico
          // (mesmo dono do formulário) — habilita ligar a resposta ao
          // paciente certo, mesmo quando o link foi enviado sem o parâmetro
          // ?p= (compartilhamento avulso/em massa, WhatsApp, impressão etc.).
          let pacienteIdResolvido: string | null = body.paciente_id || null;
          if (!form.anonimo && !pacienteIdResolvido && body.paciente_cpf) {
            const digits = onlyDigits(body.paciente_cpf);
            if (digits.length === 11) {
              const { data: pac } = await supabaseAdmin
                .from("pacientes")
                .select("paciente_id")
                .eq("id_medico", form.user_id)
                .or(`cpf.eq.${formatCpf(digits)},cpf.eq.${digits}`)
                .limit(1)
                .maybeSingle();
              if (pac) pacienteIdResolvido = pac.paciente_id;
            }
          }

          const identificacao = form.anonimo
            ? {}
            : {
                paciente_id: pacienteIdResolvido,
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

          const itensGravados: ItemGravado[] = itens.map((i) => ({
            pergunta_id: i.pergunta_id,
            valor_texto: i.valor_texto ?? null,
            valor_opcoes: i.valor_opcoes ?? null,
            valor_escala: i.valor_escala ?? null,
          }));

          if (itensGravados.length) {
            const { error: iErr } = await supabaseAdmin
              .from("questionario_resposta_itens")
              .insert(itensGravados.map((i) => ({ resposta_id: resp.id, ...i })));
            if (iErr) throw iErr;
          }

          // Paciente identificado (por CPF ou já vinculado via ?p=): registra
          // no prontuário (consulta) e cria o evento de timeline com o link
          // "Ver resposta".
          if (!form.anonimo && pacienteIdResolvido) {
            try {
              const now = new Date();
              const dateStr = now.toLocaleDateString("pt-BR");
              const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              const texto = flattenRespostas(perguntasRef, itensGravados) || "Sem respostas registradas.";

              const { error: consultaErr } = await supabaseAdmin.from("consulta").insert({
                paciente_id: pacienteIdResolvido,
                id_medico: form.user_id,
                started_at: now.toISOString(),
                ended_at: now.toISOString(),
                title: `Formulário respondido — ${form.titulo}`,
                acao: "Formulário",
                resumo: texto.slice(0, 200) + (texto.length > 200 ? "..." : ""),
                notas: texto,
              });
              if (consultaErr) console.warn("[formularios:responder] falha ao registrar no prontuário", consultaErr);

              const { error: tlErr } = await supabaseAdmin.from("timeline_events").insert({
                paciente_id: pacienteIdResolvido,
                user_id: form.user_id,
                event_date: dateStr,
                type: "questionario",
                icon: "ti-clipboard-list",
                title: `Formulário respondido — ${timeStr}`,
                sub: form.titulo,
                ref_type: "questionario_resposta",
                ref_id: resp.id,
              });
              if (tlErr) console.warn("[formularios:responder] falha ao registrar timeline", tlErr);
            } catch (linkErr) {
              // Nunca falha o envio da resposta do paciente por causa do
              // vínculo com o prontuário — a resposta já está salva.
              console.warn("[formularios:responder] falha ao vincular ao prontuário/timeline", linkErr);
            }
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
