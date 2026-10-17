import { createFileRoute } from "@tanstack/react-router";
import { exigirClinica, repoAcessos } from "@/lib/crm/dados.server";
import { AcessoSchema, IdSchema, definirAcessoClinica } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: bloqueia/libera a clínica inteira (médico dono + toda a equipe).
export const Route = createFileRoute("/api/public/crm/clinicas/$id/acesso")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ request, params, db, ator, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const { bloqueado, motivo } = await corpo(request, AcessoSchema);
        await exigirClinica(db, id);
        const usuarios = await definirAcessoClinica(
          repoAcessos(db),
          id,
          bloqueado,
          motivo ?? null,
          ator,
        );
        await auditar(bloqueado ? "clinica.bloquear" : "clinica.liberar", id, {
          motivo: motivo ?? null,
          usuarios,
        });
        return { ok: true };
      }),
    },
  },
});
