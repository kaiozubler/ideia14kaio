import { createFileRoute } from "@tanstack/react-router";
import { estornarPagamento } from "@/lib/crm/financeiro.server";
import { EstornoSchema, PagamentoIdSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: estorno total ou parcial. Pagamento manual (uuid) só registra;
// cobrança do Asaas (pay_...) pede o estorno ao Asaas e o webhook conclui.
export const Route = createFileRoute("/api/public/crm/pagamentos/$id/estorno")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ request, params, db, ator, auditar }) => {
        const id = validar(PagamentoIdSchema, params.id, "id");
        const pedido = await corpo(request, EstornoSchema);
        const resultado = await estornarPagamento(db, id, pedido, ator);
        await auditar("pagamento.estornar", id, { ...pedido, ...resultado });
        return resultado;
      }),
    },
  },
});
