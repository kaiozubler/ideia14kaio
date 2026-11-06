import { createFileRoute } from "@tanstack/react-router";
import {
  COLUNAS_CUPOM,
  catalogoPlanos,
  erroDeGravacao,
  linhaCupom,
  usosPorCupom,
} from "@/lib/cupons/dados.server";
import { CupomNovoSchema } from "@/lib/cupons/regras";
import { corpo, rotaCrm } from "@/lib/crm/rota.server";

// Zubler CRM: lista os cupons com os planos do app (GET) e cria cupom (POST).
export const Route = createFileRoute("/api/public/crm/cupons")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ db }) => {
        const { data, error } = await db
          .from("cupons")
          .select(COLUNAS_CUPOM)
          .order("created_at", { ascending: false });
        if (error) throw new Error(`cupons: ${error.message}`);
        const usos = await usosPorCupom(db);
        return {
          cupons: (data ?? []).map((c: { id: string; valor: number }) =>
            linhaCupom(c, usos.get(c.id) ?? 0),
          ),
          catalogo: catalogoPlanos(),
        };
      }),

      POST: rotaCrm(async ({ request, db, ator, auditar }) => {
        const c = await corpo(request, CupomNovoSchema);
        const { data, error } = await db
          .from("cupons")
          .insert({ ...c, criado_por: ator })
          .select(COLUNAS_CUPOM)
          .single();
        if (error) erroDeGravacao(error, c.codigo);
        await auditar("cupom.criar", data.id, c);
        return { ok: true, cupom: linhaCupom(data, 0) };
      }),
    },
  },
});
