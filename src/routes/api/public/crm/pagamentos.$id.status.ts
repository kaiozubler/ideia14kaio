import { createFileRoute } from "@tanstack/react-router";
import { repoPagamentos } from "@/lib/crm/dados.server";
import { IdSchema, PagamentoStatusSchema, alterarStatusPagamento } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: confirma ou estorna um pagamento manual (nunca apaga).
export const Route = createFileRoute("/api/public/crm/pagamentos/$id/status")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ request, params, db, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const { status, motivo } = await corpo(request, PagamentoStatusSchema);
        await alterarStatusPagamento(repoPagamentos(db), id, status, motivo ?? null);
        await auditar(`pagamento.${status === "estornado" ? "estornar" : "confirmar"}`, id, {
          status,
          motivo: motivo ?? null,
        });
        return { ok: true };
      }),
    },
  },
});
