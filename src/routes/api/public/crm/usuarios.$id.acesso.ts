import { createFileRoute } from "@tanstack/react-router";
import { repoAcessos, usuarioAuth } from "@/lib/crm/dados.server";
import { AcessoSchema, ErroCrm, IdSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: bloqueia/libera um login só (para a clínica inteira, use /clinicas/:id/acesso).
export const Route = createFileRoute("/api/public/crm/usuarios/$id/acesso")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ request, params, db, ator, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const { bloqueado, motivo } = await corpo(request, AcessoSchema);
        if (!(await usuarioAuth(db, id))) throw new ErroCrm(404, "usuário não encontrado");
        const repo = repoAcessos(db);
        if (bloqueado) await repo.bloquear([id], motivo ?? null, ator);
        else await repo.liberar([id]);
        await auditar(bloqueado ? "usuario.bloquear" : "usuario.liberar", id, {
          motivo: motivo ?? null,
        });
        return { ok: true };
      }),
    },
  },
});
