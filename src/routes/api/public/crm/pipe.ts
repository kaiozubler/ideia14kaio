import { createFileRoute } from "@tanstack/react-router";
import {
  assinaturaDe,
  carregarBase,
  idsDeClinicas,
  membrosComLogin,
  nomeClinicaDe,
} from "@/lib/crm/dados.server";
import {
  diasDesde,
  engajamento,
  faseDaClinica,
  healthScore,
  posicaoAutomaticaClinica,
  posicaoAutomaticaContratacao,
  posicaoFinal,
  type Posicao,
} from "@/lib/crm/pipe";
import { rotaCrm } from "@/lib/crm/rota.server";

type PipeRow = {
  tipo: "clinica" | "contratacao";
  ref_id: string;
  funil: string | null;
  etapa: string | null;
  responsavel: string | null;
  lost: Record<string, unknown> | null;
};
type ContratacaoRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  plano: string;
  ciclo: string;
  preco_mensal_calculado: number | null;
  nome_clinica: string | null;
  documento: string | null;
  cidade: string | null;
  estado: string | null;
  responsavel_nome: string | null;
  responsavel_email: string | null;
  responsavel_telefone: string | null;
  especialidade: string | null;
  como_conheceu: string | null;
  pagamento_confirmado_em: string | null;
  user_id: string | null;
};
type Resumo = {
  ultimo_data: string | null;
  ultimo_valor: number | null;
  total_pago: number;
  vencidas: number;
};

const PAGO_ASAAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

function falha(tabela: string, error: { message: string } | null) {
  if (error) throw new Error(`${tabela}: ${error.message}`);
}

const maisRecente = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : a.localeCompare(b) >= 0 ? a : b;

// Zubler CRM: um card por clínica (conta do médico) e por contratação sem
// conta ativada, com assinatura, pagamentos, uso e a posição na Pipe.
export const Route = createFileRoute("/api/public/crm/pipe")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ db }) => {
        const [base, pipe, contratacoes, manuais, asaas] = await Promise.all([
          carregarBase(db),
          db.from("crm_pipe").select("tipo, ref_id, funil, etapa, responsavel, lost"),
          db
            .from("contratacoes")
            .select(
              "id, created_at, updated_at, status, plano, ciclo, preco_mensal_calculado, nome_clinica, documento, cidade, estado, responsavel_nome, responsavel_email, responsavel_telefone, especialidade, como_conheceu, pagamento_confirmado_em, user_id",
            )
            .neq("status", "cancelada")
            .order("updated_at", { ascending: false }),
          db.from("pagamentos_manuais").select("medico_id, valor, status, data"),
          db.from("asaas_cobrancas").select("medico_id, valor, status, vencimento, pago_em"),
        ]);
        falha("crm_pipe", pipe.error);
        falha("contratacoes", contratacoes.error);
        falha("pagamentos_manuais", manuais.error);
        falha("asaas_cobrancas", asaas.error);

        const salvas = new Map(
          ((pipe.data ?? []) as PipeRow[]).map((p) => [`${p.tipo}:${p.ref_id}`, p]),
        );

        // Pagamentos resumidos por clínica (manuais confirmados + Asaas pagos).
        const resumos = new Map<string, Resumo>();
        const resumo = (id: string) => {
          let r = resumos.get(id);
          if (!r)
            resumos.set(
              id,
              (r = { ultimo_data: null, ultimo_valor: null, total_pago: 0, vencidas: 0 }),
            );
          return r;
        };
        const pago = (id: string, data: string | null, valor: number | null) => {
          const r = resumo(id);
          r.total_pago += Number(valor ?? 0);
          if (data && (!r.ultimo_data || data > r.ultimo_data)) {
            r.ultimo_data = data;
            r.ultimo_valor = valor == null ? null : Number(valor);
          }
        };
        for (const p of (manuais.data ?? []) as {
          medico_id: string;
          valor: number;
          status: string;
          data: string;
        }[])
          if (p.status === "confirmado") pago(p.medico_id, p.data, p.valor);
        for (const p of (asaas.data ?? []) as {
          medico_id: string | null;
          valor: number | null;
          status: string | null;
          vencimento: string | null;
          pago_em: string | null;
        }[]) {
          if (!p.medico_id) continue;
          if (p.status && PAGO_ASAAS.has(p.status))
            pago(p.medico_id, p.pago_em ?? p.vencimento, p.valor);
          else if (p.status === "OVERDUE") resumo(p.medico_id).vencidas++;
        }

        // Contratação ainda aberta de quem já tem conta vai para o card da clínica.
        const ativadas = new Set(base.assinaturas.map((a) => a.contratacao_id).filter(Boolean));
        const clinicaPorEmail = new Map<string, string>();
        for (const id of idsDeClinicas(base)) {
          const email = base.usuarios.get(id)?.email?.toLowerCase();
          if (email) clinicaPorEmail.set(email, id);
        }
        const contratacaoDaClinica = new Map<string, ContratacaoRow>();
        const contratacoesSoltas: ContratacaoRow[] = [];
        for (const c of (contratacoes.data ?? []) as ContratacaoRow[]) {
          if (ativadas.has(c.id)) continue;
          const dona =
            (c.user_id && base.usuarios.has(c.user_id) && !base.membroPorUser.has(c.user_id)
              ? c.user_id
              : null) ?? clinicaPorEmail.get(c.responsavel_email?.toLowerCase() ?? "");
          if (dona) {
            if (!contratacaoDaClinica.has(dona)) contratacaoDaClinica.set(dona, c);
          } else contratacoesSoltas.push(c);
        }

        const agora = Date.now();
        const montar = (
          tipo: "clinica" | "contratacao",
          id: string,
          fase: "lead" | "cliente",
          automatica: Posicao,
          autoLost: Record<string, unknown> | null,
        ) => {
          const salva = salvas.get(`${tipo}:${id}`) ?? null;
          const pos = posicaoFinal(fase, automatica, salva);
          return {
            chave: `${tipo}:${id}`,
            tipo,
            id,
            fase,
            funil: pos.funil,
            etapa: pos.etapa,
            posicao_automatica: pos === automatica,
            responsavel: salva?.responsavel ?? null,
            lost: salva?.lost ?? autoLost,
          };
        };

        const cards: unknown[] = [];

        for (const id of idsDeClinicas(base)) {
          const dono = base.usuarios.get(id)!;
          const config = base.configs.get(id);
          const a = assinaturaDe(base, id);
          const vigente = a && a.status !== "cancelada" ? a : null;
          const situacao = {
            assinatura: (a?.status ?? null) as "ativa" | "inadimplente" | "cancelada" | null,
            assinatura_desde: a?.created_at ?? null,
          };
          const fase = faseDaClinica(situacao);
          const contratacao = contratacaoDaClinica.get(id) ?? null;
          const automatica =
            fase === "lead" && contratacao
              ? posicaoAutomaticaContratacao({
                  status: contratacao.status,
                  pago: !!contratacao.pagamento_confirmado_em,
                })
              : posicaoAutomaticaClinica(situacao, agora);
          const membros = membrosComLogin(base, id);
          let ultimoLogin = dono.last_sign_in_at ?? null;
          for (const m of membros)
            ultimoLogin = maisRecente(ultimoLogin, base.usuarios.get(m)?.last_sign_in_at ?? null);
          const dias = diasDesde(ultimoLogin, agora);
          const pag = resumos.get(id) ?? {
            ultimo_data: null,
            ultimo_valor: null,
            total_pago: 0,
            vencidas: 0,
          };
          const bloqueado = base.bloqueios.has(id);
          const autoLost =
            a?.status === "cancelada"
              ? {
                  reason: "Assinatura cancelada no app",
                  date: (a.updated_at ?? "").slice(0, 10),
                  automatico: true,
                }
              : null;

          cards.push({
            ...montar("clinica", id, fase, automatica, autoLost),
            nome: nomeClinicaDe(base, id) ?? dono.email ?? "Sem nome",
            razao_social: config?.razao_social ?? null,
            documento: config?.cnpj_cpf ?? null,
            email: config?.email || dono.email || null,
            telefone: config?.telefone ?? (dono.phone || null),
            cidade: config?.cidade ?? null,
            uf: config?.uf ?? null,
            plano: vigente?.plano ?? contratacao?.plano ?? "free",
            ciclo: vigente?.ciclo ?? contratacao?.ciclo ?? null,
            assinatura_status: a?.status ?? null,
            mrr: vigente ? Number(vigente.preco_mensal) : 0,
            mrr_potencial:
              !vigente && contratacao?.preco_mensal_calculado != null
                ? Number(contratacao.preco_mensal_calculado)
                : null,
            proxima_cobranca: vigente?.proxima_cobranca ?? null,
            cancelamento_agendado_para: vigente?.cancelamento_agendado_para ?? null,
            criado_em: dono.created_at ?? null,
            cliente_desde: vigente?.created_at ?? null,
            ultimo_login: ultimoLogin,
            dias_sem_login: dias,
            membros: membros.length,
            acesso_bloqueado: bloqueado,
            pagamentos: pag,
            contratacao: contratacao
              ? {
                  id: contratacao.id,
                  status: contratacao.status,
                  pago_em: contratacao.pagamento_confirmado_em,
                  responsavel_email: contratacao.responsavel_email,
                }
              : null,
            hs: healthScore({
              dias_sem_login: dias,
              inadimplente: a?.status === "inadimplente",
              cobrancas_vencidas: pag.vencidas,
              acesso_bloqueado: bloqueado,
              membros: membros.length,
            }),
            engajamento: engajamento(dias),
          });
        }

        for (const c of contratacoesSoltas) {
          const dias = diasDesde(c.updated_at, agora);
          cards.push({
            ...montar(
              "contratacao",
              c.id,
              "lead",
              posicaoAutomaticaContratacao({ status: c.status, pago: !!c.pagamento_confirmado_em }),
              null,
            ),
            nome:
              c.nome_clinica || c.responsavel_nome || c.responsavel_email || "Contratação sem nome",
            razao_social: c.nome_clinica,
            documento: c.documento,
            email: c.responsavel_email,
            telefone: c.responsavel_telefone,
            cidade: c.cidade,
            uf: c.estado,
            responsavel_nome: c.responsavel_nome,
            especialidade: c.especialidade,
            como_conheceu: c.como_conheceu,
            plano: c.plano,
            ciclo: c.ciclo,
            assinatura_status: null,
            mrr: 0,
            mrr_potencial:
              c.preco_mensal_calculado == null ? null : Number(c.preco_mensal_calculado),
            proxima_cobranca: null,
            cancelamento_agendado_para: null,
            criado_em: c.created_at,
            cliente_desde: null,
            ultimo_login: null,
            dias_sem_login: null,
            membros: 0,
            acesso_bloqueado: false,
            pagamentos: { ultimo_data: null, ultimo_valor: null, total_pago: 0, vencidas: 0 },
            contratacao: {
              id: c.id,
              status: c.status,
              pago_em: c.pagamento_confirmado_em,
              responsavel_email: c.responsavel_email,
            },
            // Lead sem conta: o "uso" é a última vez que mexeu na contratação.
            hs: healthScore({
              dias_sem_login: dias,
              inadimplente: false,
              cobrancas_vencidas: 0,
              acesso_bloqueado: false,
              membros: 0,
            }),
            engajamento: engajamento(dias),
          });
        }

        return { cards };
      }),
    },
  },
});
