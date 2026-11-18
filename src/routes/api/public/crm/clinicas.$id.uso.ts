import { createFileRoute } from "@tanstack/react-router";
import { DiasUsoSchema, IdSchema } from "@/lib/crm/ponte";
import { rotaCrm, validar } from "@/lib/crm/rota.server";
import { usoDaClinica } from "@/lib/crm/uso.server";

// Zubler CRM: uso de uma clínica, com os logins da equipe e as telas. ?dias=
export const Route = createFileRoute("/api/public/crm/clinicas/$id/uso")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ request, params, db }) => {
        const id = validar(IdSchema, params.id, "id");
        const dias = validar(
          DiasUsoSchema,
          new URL(request.url).searchParams.get("dias") ?? undefined,
          "dias",
        );
        return usoDaClinica(db, id, dias);
      }),
    },
  },
});
