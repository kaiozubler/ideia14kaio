import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  COLUNAS_CONTRATACAO_CUPOM,
  avaliarCupom,
  resumoParaCliente,
} from "@/lib/cupons/contratacao.server";

// Aplica (ou remove, com codigo null) um cupom na contratação em andamento.
// Mesmo modelo de acesso de /api/contratacao: quem tem o id da contratação
// (só existe no sessionStorage de quem criou) pode mexer nela. O cupom é
// conferido de novo ao gerar a cobrança (/api/asaas/checkout), então trocar
// de plano depois de aplicar não burla a regra do cupom.

const BodySchema = z.object({
  id: z.string().uuid(),
  codigo: z.string().trim().min(1).max(60).nullable(),
});

export const Route = createFileRoute("/api/contratacao/cupom")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = BodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // cupons / cupom_id ainda não estão no types.ts gerado.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        const { data: c, error } = await db
          .from("contratacoes")
          .select(COLUNAS_CONTRATACAO_CUPOM)
          .eq("id", body.data.id)
          .maybeSingle();
        if (error) {
          console.error("[contratacao:cupom]", error.message);
          return Response.json({ error: "não foi possível conferir o cupom" }, { status: 500 });
        }
        if (!c) return Response.json({ error: "contratação não encontrada" }, { status: 404 });
        if (c.status === "confirmada") {
          return Response.json({ error: "esta contratação já foi paga" }, { status: 409 });
        }

        if (body.data.codigo === null) {
          await db
            .from("contratacoes")
            .update({ cupom_id: null, cupom_aplicado: null })
            .eq("id", c.id);
          return Response.json({ ok: true, cupom: null });
        }

        try {
          const av = await avaliarCupom(db, c, body.data.codigo);
          if (!av.ok) return Response.json({ error: av.motivo }, { status: av.status });
          const { error: errUpd } = await db
            .from("contratacoes")
            .update({ cupom_id: av.cupomId })
            .eq("id", c.id);
          if (errUpd) throw new Error(errUpd.message);
          const ciclo = c.ciclo === "anual" ? "anual" : "mensal";
          return Response.json({
            ok: true,
            cupom: resumoParaCliente(av.cupom, av.precoMensal, ciclo),
          });
        } catch (err) {
          console.error("[contratacao:cupom]", err);
          return Response.json({ error: "não foi possível conferir o cupom" }, { status: 500 });
        }
      },
    },
  },
});
