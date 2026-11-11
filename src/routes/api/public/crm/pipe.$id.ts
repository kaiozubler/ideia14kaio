import { createFileRoute } from "@tanstack/react-router";
import { exigirClinica } from "@/lib/crm/dados.server";
import { ErroCrm, IdSchema } from "@/lib/crm/ponte";
import { PipePatchSchema } from "@/lib/crm/pipe";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: grava a posição do card na Pipe, o responsável da equipe e o
// cancelamento (lost). Só mexe na tabela crm_pipe; os dados do cliente não mudam.
export const Route = createFileRoute("/api/public/crm/pipe/$id")({
  server: {
    handlers: {
      PATCH: rotaCrm(async ({ request, params, db, ator, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const p = await corpo(request, PipePatchSchema);

        if (p.tipo === "clinica") await exigirClinica(db, id);
        else {
          const { data, error } = await db
            .from("contratacoes")
            .select("id")
            .eq("id", id)
            .maybeSingle();
          if (error) throw new Error(`contratacoes: ${error.message}`);
          if (!data) throw new ErroCrm(404, "contratação não encontrada");
        }

        const { data: atual, error: erroLeitura } = await db
          .from("crm_pipe")
          .select("funil, etapa, responsavel, lost")
          .eq("tipo", p.tipo)
          .eq("ref_id", id)
          .maybeSingle();
        if (erroLeitura) throw new Error(`crm_pipe: ${erroLeitura.message}`);

        const linha = {
          tipo: p.tipo,
          ref_id: id,
          funil: p.funil ?? atual?.funil ?? null,
          etapa: p.etapa ?? atual?.etapa ?? null,
          responsavel: p.responsavel !== undefined ? p.responsavel : (atual?.responsavel ?? null),
          lost: p.lost !== undefined ? p.lost : (atual?.lost ?? null),
          atualizado_por: ator,
          atualizado_em: new Date().toISOString(),
        };
        const { error } = await db.from("crm_pipe").upsert(linha, { onConflict: "tipo,ref_id" });
        if (error) throw new Error(`crm_pipe: ${error.message}`);
        await auditar("pipe.atualizar", `${p.tipo}:${id}`, p);
        return { ok: true };
      }),
    },
  },
});
