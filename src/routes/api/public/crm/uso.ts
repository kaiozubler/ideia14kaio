import { createFileRoute } from "@tanstack/react-router";
import { DiasUsoSchema } from "@/lib/crm/ponte";
import { rotaCrm, validar } from "@/lib/crm/rota.server";
import { usoDaCarteira } from "@/lib/crm/uso.server";

// Zubler CRM: uso do app pela carteira (acessos, telas, movimentação),
// comparado com o período anterior, a média histórica e os parceiros, com
// alertas de churn, queda de uso e upgrade. ?dias=7|14|30|60|90
export const Route = createFileRoute("/api/public/crm/uso")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ request, db }) => {
        const dias = validar(
          DiasUsoSchema,
          new URL(request.url).searchParams.get("dias") ?? undefined,
          "dias",
        );
        return usoDaCarteira(db, dias);
      }),
    },
  },
});
