import { createFileRoute } from "@tanstack/react-router";
import { detalheClinica, exigirClinica } from "@/lib/crm/dados.server";
import { ClinicaPatchSchema, IdSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: detalhe da clínica (GET) e edição dos dados cadastrais (PATCH).
export const Route = createFileRoute("/api/public/crm/clinicas/$id")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ params, db }) => {
        const id = validar(IdSchema, params.id, "id");
        return detalheClinica(db, id);
      }),

      PATCH: rotaCrm(async ({ request, params, db, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const dados = await corpo(request, ClinicaPatchSchema);
        await exigirClinica(db, id);
        const { error } = await db
          .from("medico_clinica_config")
          .upsert({ id_medico: id, ...dados }, { onConflict: "id_medico" });
        if (error) throw new Error(`medico_clinica_config: ${error.message}`);
        await auditar("clinica.atualizar", id, dados);
        return { ok: true };
      }),
    },
  },
});
