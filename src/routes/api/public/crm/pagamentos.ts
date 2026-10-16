import { createFileRoute } from "@tanstack/react-router";
import {
  carregarBase,
  exigirClinica,
  listarPagamentos,
  nomeClinicaDe,
  reativarSeInadimplente,
} from "@/lib/crm/dados.server";
import { PagamentoNovoSchema } from "@/lib/crm/ponte";
import { corpo, rotaCrm } from "@/lib/crm/rota.server";

type Contratacao = {
  id: string;
  nome_clinica: string | null;
  responsavel_email: string | null;
  plano: string;
  preco_mensal_calculado: number | null;
  pagamento_confirmado_em: string;
};

// Zubler CRM: visão financeira (GET) e lançamento de pagamento manual (POST).
export const Route = createFileRoute("/api/public/crm/pagamentos")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ db }) => {
        const base = await carregarBase(db);
        const pagamentos = await listarPagamentos(db, base, { limite: 200 });

        const inadimplentes = base.assinaturas
          .filter((a) => a.status === "inadimplente")
          .map((a) => ({
            clinica_id: a.medico_id,
            nome: nomeClinicaDe(base, a.medico_id),
            plano: a.plano,
            preco_mensal: Number(a.preco_mensal),
            desde: a.ultimo_erro_cobranca?.em ?? a.updated_at,
          }));

        const { data, error } = await db
          .from("contratacoes")
          .select(
            "id, nome_clinica, responsavel_email, plano, preco_mensal_calculado, pagamento_confirmado_em",
          )
          .not("pagamento_confirmado_em", "is", null)
          .order("pagamento_confirmado_em", { ascending: false });
        if (error) throw new Error(`contratacoes: ${error.message}`);
        const ativadas = new Set(base.assinaturas.map((a) => a.contratacao_id).filter(Boolean));
        const contratacoes_pendentes = ((data ?? []) as Contratacao[])
          .filter((c) => !ativadas.has(c.id))
          .map((c) => ({
            ...c,
            preco_mensal_calculado:
              c.preco_mensal_calculado == null ? null : Number(c.preco_mensal_calculado),
          }));

        return { pagamentos, inadimplentes, contratacoes_pendentes };
      }),

      POST: rotaCrm(async ({ request, db, ator, auditar }) => {
        const p = await corpo(request, PagamentoNovoSchema);
        await exigirClinica(db, p.clinica_id);
        const { data: assinatura } = await db
          .from("assinaturas")
          .select("id")
          .eq("medico_id", p.clinica_id)
          .neq("status", "cancelada")
          .maybeSingle();
        const { data, error } = await db
          .from("pagamentos_manuais")
          .insert({
            medico_id: p.clinica_id,
            assinatura_id: assinatura?.id ?? null,
            valor: p.valor,
            metodo: p.metodo,
            data: p.data,
            referencia: p.referencia ?? null,
            observacao: p.observacao ?? null,
            status: "confirmado",
            criado_por: ator,
          })
          .select("id")
          .single();
        if (error) throw new Error(`pagamentos_manuais: ${error.message}`);
        await reativarSeInadimplente(db, p.clinica_id);
        await auditar("pagamento.criar", data.id, p);
        return { ok: true, id: data.id };
      }),
    },
  },
});
