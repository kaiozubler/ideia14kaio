import { createFileRoute } from "@tanstack/react-router";
import {
  COLUNAS_CUPOM,
  buscarCupom,
  erroDeGravacao,
  linhaCupom,
  usosPorCupom,
} from "@/lib/cupons/dados.server";
import { CupomCompletoSchema, CupomPatchSchema } from "@/lib/cupons/regras";
import { IdSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: edita um cupom (inclusive ativar/desativar). O nome não muda.
export const Route = createFileRoute("/api/public/crm/cupons/$id")({
  server: {
    handlers: {
      PATCH: rotaCrm(async ({ request, params, db, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const patch = await corpo(request, CupomPatchSchema);
        const atual = await buscarCupom(db, id);
        // Revalida o cupom inteiro: trocar só o tipo pode quebrar o valor salvo.
        const {
          codigo,
          id: _id,
          criado_por: _p,
          created_at: _c,
          updated_at: _u,
          ...campos
        } = atual;
        const completo = validar(CupomCompletoSchema, {
          ...campos,
          valor: Number(atual.valor),
          ...patch,
        });
        const { data, error } = await db
          .from("cupons")
          .update({ ...completo, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select(COLUNAS_CUPOM)
          .single();
        if (error) erroDeGravacao(error, String(codigo));
        await auditar("cupom.editar", id, patch);
        const usos = await usosPorCupom(db, [id]);
        return { ok: true, cupom: linhaCupom(data, usos.get(id) ?? 0) };
      }),
    },
  },
});
