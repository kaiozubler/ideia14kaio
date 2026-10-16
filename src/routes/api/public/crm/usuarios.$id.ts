import { createFileRoute } from "@tanstack/react-router";
import { usuarioAuth } from "@/lib/crm/dados.server";
import { ErroCrm, IdSchema, UsuarioPatchSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: troca nome/e-mail do login (Auth) e do vínculo de equipe.
export const Route = createFileRoute("/api/public/crm/usuarios/$id")({
  server: {
    handlers: {
      PATCH: rotaCrm(async ({ request, params, db, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const { nome, email } = await corpo(request, UsuarioPatchSchema);
        const atual = await usuarioAuth(db, id);
        if (!atual) throw new ErroCrm(404, "usuário não encontrado");

        const mudancas: Record<string, unknown> = {};
        // O e-mail troca direto (confirmado), sem o fluxo de confirmação do Supabase:
        // quem pede é o suporte, não o próprio usuário.
        if (email !== undefined && email !== atual.email)
          Object.assign(mudancas, { email, email_confirm: true });
        if (nome !== undefined)
          mudancas.user_metadata = { ...(atual.user_metadata ?? {}), name_user: nome };
        if (Object.keys(mudancas).length) {
          const { error } = await db.auth.admin.updateUserById(id, mudancas);
          if (error) {
            const codigo = (error as { code?: string }).code;
            if (codigo === "email_exists" || /already|registered|exists/i.test(error.message))
              throw new ErroCrm(409, "já existe um usuário com este e-mail");
            throw new ErroCrm(400, error.message);
          }
        }

        const perfil: Record<string, string> = {};
        if (nome !== undefined) perfil.nome = nome;
        if (email !== undefined) perfil.email = email;
        const { error } = await db.from("clinica_membros").update(perfil).eq("user_id", id);
        if (error) {
          if (error.code === "23505")
            throw new ErroCrm(409, "este e-mail já está na equipe da clínica");
          throw new Error(`clinica_membros: ${error.message}`);
        }

        await auditar("usuario.atualizar", id, {
          nome,
          email,
          email_anterior: atual.email ?? null,
        });
        return { ok: true };
      }),
    },
  },
});
