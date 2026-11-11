import { createFileRoute } from "@tanstack/react-router";
import { reativarAssinatura } from "@/lib/crm/financeiro.server";
import { IdSchema } from "@/lib/crm/ponte";
import { rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: desfaz um cancelamento agendado pela equipe.
export const Route = createFileRoute("/api/public/crm/assinaturas/$id/reativar")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ params, db, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const resultado = await reativarAssinatura(db, id);
        await auditar("assinatura.reativar", id, {});
        return resultado;
      }),
    },
  },
});
