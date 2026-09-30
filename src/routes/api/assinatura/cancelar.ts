import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { asaasFetch } from "@/lib/asaas/client.server";
import {
  assinaturaAtiva,
  clienteAdmin,
  hojeISO,
  respostaErroAsaas,
  usuarioDaRequisicao,
} from "@/lib/assinatura/gestao.server";

// Cancela a assinatura de quem está logado. As cobranças param na hora
// (a assinatura é removida no Asaas), mas o acesso continua até o fim do
// período já pago — cancelamento_agendado_para = próxima cobrança. Depois
// dessa data, aplicar_agendamentos_assinatura() marca a linha como
// 'cancelada'. Sem data de próxima cobrança conhecida, cancela na hora.
//
// Não é reversível por aqui (a assinatura no Asaas já foi removida): pra
// voltar, a pessoa contrata de novo em /planos.

const BodySchema = z.object({
  motivo: z.string().trim().max(80).optional(),
  comentario: z.string().trim().max(1000).optional(),
});

export const Route = createFileRoute("/api/assinatura/cancelar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await usuarioDaRequisicao(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = BodySchema.safeParse((await request.json().catch(() => null)) ?? {});
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const assinatura = await assinaturaAtiva(userId);
        if (!assinatura)
          return Response.json({ error: "nenhuma assinatura ativa encontrada" }, { status: 404 });
        if (assinatura.cancelamento_agendado_para) {
          return Response.json({ error: "o cancelamento já foi solicitado" }, { status: 409 });
        }

        if (assinatura.asaas_subscription_id) {
          try {
            await asaasFetch(`/subscriptions/${assinatura.asaas_subscription_id}`, {
              method: "DELETE",
            });
          } catch (err) {
            return respostaErroAsaas("cancelar", err);
          }
        }

        const proxima: string | null = assinatura.proxima_cobranca;
        // Inadimplente não tem "período pago" pra honrar — cancela na hora.
        const manterAcesso = assinatura.status === "ativa" && !!proxima && proxima > hojeISO();
        const motivo = [body.data.motivo, body.data.comentario].filter(Boolean).join(" — ") || null;

        const supabaseAdmin = await clienteAdmin();
        const { error: erroUpdate } = await supabaseAdmin
          .from("assinaturas")
          .update({
            status: manterAcesso ? assinatura.status : "cancelada",
            cancelamento_agendado_para: manterAcesso ? proxima : hojeISO(),
            cancelamento_solicitado_em: new Date().toISOString(),
            cancelamento_motivo: motivo,
            plano_agendado: null,
            plano_agendado_para: null,
          })
          .eq("id", assinatura.id);

        if (erroUpdate) {
          console.error("[assinatura:cancelar] erro ao atualizar localmente:", erroUpdate.message);
          return Response.json(
            { error: "cancelado no Asaas, mas houve erro ao salvar localmente — avise o suporte" },
            { status: 500 },
          );
        }

        return Response.json({ ok: true, acessoAte: manterAcesso ? proxima : null });
      },
    },
  },
});
