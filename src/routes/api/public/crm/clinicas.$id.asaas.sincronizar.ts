import { createFileRoute } from "@tanstack/react-router";
import { assinaturaDe, carregarBase, detalheClinica } from "@/lib/crm/dados.server";
import { sincronizarComAsaas } from "@/lib/crm/financeiro.server";
import { ErroCrm, IdSchema } from "@/lib/crm/ponte";
import { rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: busca no Asaas a assinatura e as cobranças da clínica (útil
// quando um webhook se perdeu) e responde o mesmo que GET clinicas/:id.
export const Route = createFileRoute("/api/public/crm/clinicas/$id/asaas/sincronizar")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ params, db, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const assinatura = assinaturaDe(await carregarBase(db), id);
        if (!assinatura) throw new ErroCrm(404, "a clínica não tem assinatura");
        const cobrancas = await sincronizarComAsaas(db, assinatura);
        await auditar("clinica.asaas_sincronizar", id, { assinatura_id: assinatura.id, cobrancas });
        return detalheClinica(db, id);
      }),
    },
  },
});
