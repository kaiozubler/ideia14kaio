import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Registra a decisão do médico numa tarefa "Decidir" (condição do protocolo
// que o motor não avalia sozinho — ver compilarDecisao em
// src/lib/protocolos/estudio-compilar.server.ts). A opção escolhida entra no
// motor como resultado em texto, e avaliar_resultado_tarefa dispara as ações
// do ramo correspondente, igual a um resultado de exame.
//
// Também conclui alertas simples: POST { tarefaId } sem opção.

const BodySchema = z.object({
  tarefaId: z.string().uuid(),
  opcao: z.string().min(1).max(64).optional(),
});

export const Route = createFileRoute("/api/protocolos/decidir")({
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
        const { tarefaId, opcao } = parsed.data;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: tarefa, error: tErr } = await supabaseAdmin
            .from("protocolo_tarefas")
            .select("id,user_id,acao_id,status")
            .eq("id", tarefaId)
            .maybeSingle();
          if (tErr) throw tErr;
          if (!tarefa || tarefa.user_id !== userId)
            return Response.json({ error: "not_found" }, { status: 404 });
          if (tarefa.status === "concluido")
            return Response.json({ error: "Esta etapa já foi concluída." }, { status: 409 });

          if (!opcao) {
            const { error } = await supabaseAdmin
              .from("protocolo_tarefas")
              .update({ status: "concluido", resultado_registrado_em: new Date().toISOString() })
              .eq("id", tarefaId);
            if (error) throw error;
            return Response.json({ status: "concluido" });
          }

          // A opção precisa ser uma das regras da própria ação (evita texto livre
          // casando por acidente com outra regra).
          const { data: regras, error: rErr } = await supabaseAdmin
            .from("protocolo_regras")
            .select("id,condicao")
            .eq("acao_gatilho_id", tarefa.acao_id);
          if (rErr) throw rErr;
          const valida = (regras || []).some(
            (r) => (r.condicao as { texto?: string } | null)?.texto === opcao,
          );
          if (!valida)
            return Response.json({ error: "Opção inválida para esta decisão." }, { status: 400 });

          const { data, error } = await supabaseAdmin.rpc("avaliar_resultado_tarefa", {
            p_tarefa_id: tarefaId,
            p_resultado: { texto: opcao },
          });
          if (error) throw error;
          const row = (data as { status: string; tarefas_criadas: number }[] | null)?.[0];
          return Response.json({
            status: row?.status || "concluido",
            tarefasCriadas: row?.tarefas_criadas ?? 0,
          });
        } catch (err) {
          console.error("[protocolos:decidir]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
