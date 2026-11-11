import { createFileRoute } from "@tanstack/react-router";
import { cancelarAssinatura } from "@/lib/crm/financeiro.server";
import { CancelarAssinaturaSchema, IdSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: cancela a assinatura no fim do ciclo (endDate no Asaas, acesso
// até a próxima cobrança) ou agora (remove a assinatura no Asaas).
export const Route = createFileRoute("/api/public/crm/assinaturas/$id/cancelar")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ request, params, db, ator, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const pedido = await corpo(request, CancelarAssinaturaSchema);
        const resultado = await cancelarAssinatura(db, id, pedido, ator);
        await auditar("assinatura.cancelar", id, { ...pedido, ...resultado });
        return resultado;
      }),
    },
  },
});
