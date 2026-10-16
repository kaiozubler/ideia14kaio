import { createFileRoute } from "@tanstack/react-router";
import {
  assinaturaDe,
  carregarBase,
  exigirClinica,
  listarPagamentos,
  membrosComLogin,
  montarUsuario,
} from "@/lib/crm/dados.server";
import { ClinicaPatchSchema, ErroCrm, IdSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: detalhe da clínica (GET) e edição dos dados cadastrais (PATCH).
export const Route = createFileRoute("/api/public/crm/clinicas/$id")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ params, db }) => {
        const id = validar(IdSchema, params.id, "id");
        const base = await carregarBase(db);
        const dono = base.usuarios.get(id);
        if (!dono || base.membroPorUser.has(id)) throw new ErroCrm(404, "clínica não encontrada");
        const config = base.configs.get(id);
        const bloqueio = base.bloqueios.get(id);
        const a = assinaturaDe(base, id);
        return {
          clinica: {
            id,
            fantasia: config?.fantasia ?? null,
            razao_social: config?.razao_social ?? null,
            cnpj_cpf: config?.cnpj_cpf ?? null,
            email: config?.email ?? dono.email ?? null,
            telefone: config?.telefone ?? null,
            cidade: config?.cidade ?? null,
            uf: config?.uf ?? null,
            acesso_bloqueado: !!bloqueio,
            bloqueio_motivo: bloqueio?.motivo ?? null,
          },
          medico: montarUsuario(base, dono),
          membros: membrosComLogin(base, id)
            .map((uid) => base.usuarios.get(uid))
            .filter((u) => !!u)
            .map((u) => montarUsuario(base, u)),
          assinatura: a
            ? {
                id: a.id,
                plano: a.plano,
                ciclo: a.ciclo,
                status: a.status,
                preco_mensal: Number(a.preco_mensal),
                proxima_cobranca: a.proxima_cobranca,
                medicos: a.medicos,
                secretarias: a.secretarias,
                cancelamento_agendado_para: a.cancelamento_agendado_para,
              }
            : null,
          pagamentos: await listarPagamentos(db, base, { clinicaId: id, limite: 200 }),
        };
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
