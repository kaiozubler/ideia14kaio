import { createFileRoute } from "@tanstack/react-router";
import { carregarBase, casaBusca, montarUsuario } from "@/lib/crm/dados.server";
import { BuscaSchema } from "@/lib/crm/ponte";
import { rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: todos os logins (médicos donos de clínica e membros de equipe).
export const Route = createFileRoute("/api/public/crm/usuarios")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ request, db }) => {
        const busca = validar(
          BuscaSchema,
          new URL(request.url).searchParams.get("busca") ?? undefined,
          "busca",
        );
        const base = await carregarBase(db);
        const usuarios = [...base.usuarios.values()]
          .map((u) => montarUsuario(base, u))
          .filter((u) => casaBusca(busca, u.nome, u.email, u.clinica_nome))
          .sort((a, b) =>
            (a.nome ?? a.email ?? "").localeCompare(b.nome ?? b.email ?? "", "pt-BR"),
          );
        return { usuarios };
      }),
    },
  },
});
