// Regras da ponte do Zubler CRM que não dependem do Supabase: autenticação
// pelo CRM_BRIDGE_TOKEN, schemas de entrada e as operações de bloqueio e de
// status de pagamento. Ficam aqui, recebendo o acesso a dados por interface,
// para os testes (tests/crm-ponte.test.ts) rodarem sem banco.

import { z } from "zod";

export class ErroCrm extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

async function sha256(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

/**
 * Confere `Authorization: Bearer <token>` contra o segredo em tempo
 * constante: compara os SHA-256 (mesmo tamanho sempre) byte a byte sem sair
 * cedo, para o tempo de resposta não revelar quantos caracteres bateram.
 */
export async function tokenCrmValido(
  authorization: string | null,
  esperado: string | undefined,
): Promise<boolean> {
  if (!esperado || !authorization?.startsWith("Bearer ")) return false;
  const [a, b] = await Promise.all([sha256(authorization.slice(7)), sha256(esperado)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Schemas de entrada
// ---------------------------------------------------------------------------

const texto = (max: number) => z.string().trim().max(max);
const textoOuNulo = (max: number) => texto(max).nullable().optional();

export const IdSchema = z.string().uuid();
export const BuscaSchema = texto(200).optional().default("");

export const ClinicaPatchSchema = z
  .object({
    fantasia: textoOuNulo(200),
    razao_social: textoOuNulo(200),
    cnpj_cpf: textoOuNulo(30),
    email: z.string().trim().email().max(255).nullable().optional(),
    telefone: textoOuNulo(40),
    cidade: textoOuNulo(120),
    uf: z.string().trim().length(2).toUpperCase().nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "informe ao menos um campo");

export const AcessoSchema = z.object({
  bloqueado: z.boolean(),
  motivo: textoOuNulo(500),
});

export const UsuarioPatchSchema = z
  .object({
    nome: texto(200).min(1).optional(),
    email: z.string().trim().toLowerCase().email().max(255).optional(),
  })
  .strict()
  .refine((d) => d.nome !== undefined || d.email !== undefined, "informe nome ou email");

export const METODOS = ["pix", "boleto", "cartao", "transferencia", "outro"] as const;

export const PagamentoNovoSchema = z.object({
  clinica_id: IdSchema,
  valor: z.coerce.number().positive().max(10_000_000),
  metodo: z.enum(METODOS),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD"),
  referencia: textoOuNulo(200),
  observacao: textoOuNulo(2000),
});

export const PagamentoStatusSchema = z.object({
  status: z.enum(["confirmado", "estornado"]),
  motivo: textoOuNulo(500),
});

export const AtivarContratacaoSchema = z.object({
  medico_email: z.string().trim().toLowerCase().email().max(255),
});

// ---------------------------------------------------------------------------
// Bloqueio de acesso
// ---------------------------------------------------------------------------

export interface RepoAcessos {
  /** user_id dos membros da equipe (clinica_membros) que já têm login. */
  membrosDaClinica(clinicaId: string): Promise<string[]>;
  bloquear(userIds: string[], motivo: string | null, por: string): Promise<void>;
  liberar(userIds: string[]): Promise<void>;
}

/** Bloqueia ou libera o médico dono da clínica e todos os membros dela. Devolve quem foi afetado. */
export async function definirAcessoClinica(
  repo: RepoAcessos,
  clinicaId: string,
  bloqueado: boolean,
  motivo: string | null,
  ator: string,
): Promise<string[]> {
  const ids = [...new Set([clinicaId, ...(await repo.membrosDaClinica(clinicaId))])];
  if (bloqueado) await repo.bloquear(ids, motivo, ator);
  else await repo.liberar(ids);
  return ids;
}

// ---------------------------------------------------------------------------
// Pagamentos manuais
// ---------------------------------------------------------------------------

export type StatusPagamento = "pendente" | "confirmado" | "estornado";

export interface RepoPagamentos {
  buscar(id: string): Promise<{ id: string; medico_id: string; status: StatusPagamento } | null>;
  atualizarStatus(id: string, status: StatusPagamento, estornoMotivo: string | null): Promise<void>;
  /** assinatura `inadimplente` da clínica volta para `ativa`. */
  reativarSeInadimplente(medicoId: string): Promise<void>;
}

/**
 * Confirma ou estorna um pagamento manual. Nunca apaga: o estorno só troca o
 * status e guarda o motivo, e a confirmação tira a clínica da inadimplência.
 */
export async function alterarStatusPagamento(
  repo: RepoPagamentos,
  id: string,
  status: "confirmado" | "estornado",
  motivo: string | null,
): Promise<void> {
  const pagamento = await repo.buscar(id);
  if (!pagamento) throw new ErroCrm(404, "pagamento não encontrado");
  if (pagamento.status === "estornado" && status === "confirmado")
    throw new ErroCrm(409, "pagamento estornado não pode voltar a confirmado; lance um novo");
  await repo.atualizarStatus(id, status, status === "estornado" ? motivo : null);
  if (status === "confirmado") await repo.reativarSeInadimplente(pagamento.medico_id);
}

/** Nome exibido da clínica: fantasia, depois razão social, depois o nome do médico. */
export function nomeDaClinica(
  config: { fantasia?: string | null; razao_social?: string | null } | null | undefined,
  nomeMedico: string | null,
): string | null {
  return config?.fantasia?.trim() || config?.razao_social?.trim() || nomeMedico || null;
}

// ---------------------------------------------------------------------------
// Financeiro (contrato v2): status, estorno e cancelamento
// ---------------------------------------------------------------------------

/** Id de pagamento na ponte: uuid (manual) ou id de cobrança do Asaas (pay_...). */
export const PagamentoIdSchema = z.union([
  IdSchema,
  z.string().regex(/^pay_[A-Za-z0-9]{1,64}$/, "id de pagamento inválido"),
]);

export const EstornoSchema = z.object({
  /** Ausente = estorna o que ainda resta do pagamento. */
  valor: z.coerce.number().positive().max(10_000_000).optional(),
  motivo: textoOuNulo(500),
});

export const CancelarAssinaturaSchema = z.object({
  quando: z.enum(["fim_do_ciclo", "agora"]),
  motivo: textoOuNulo(200),
  observacao: textoOuNulo(2000),
  cancelar_pendentes: z.boolean().optional().default(false),
});

const DO_ASAAS: Record<string, string> = {
  PENDING: "pendente",
  AWAITING_RISK_ANALYSIS: "pendente",
  OVERDUE: "vencido",
  CONFIRMED: "confirmado",
  RECEIVED: "recebido",
  RECEIVED_IN_CASH: "recebido",
  REFUND_REQUESTED: "estorno_solicitado",
  REFUND_IN_PROGRESS: "estorno_solicitado",
  CHARGEBACK_REQUESTED: "estorno_solicitado",
  CHARGEBACK_DISPUTE: "estorno_solicitado",
  AWAITING_CHARGEBACK_REVERSAL: "estorno_solicitado",
  REFUNDED: "estornado",
  DELETED: "cancelado",
};

const centavos = (v: number) => Math.round(v * 100);

/**
 * Status em português de uma cobrança, levando em conta o que já foi
 * estornado (inclusive estornos ainda em andamento no Asaas).
 */
export function statusDaCobranca(
  status: string | null,
  valor: number | null,
  estornado: number,
): string {
  const base = status ? (DO_ASAAS[status] ?? status.toLowerCase()) : "pendente";
  const v = centavos(valor ?? 0);
  const e = centavos(estornado);
  if (e <= 0) return base;
  if (v > 0 && e < v) return "estorno_parcial";
  return base === "estornado" ? "estornado" : "estorno_solicitado";
}

const PAGOS = new Set(["confirmado", "recebido", "estorno_parcial"]);

/**
 * Quanto estornar de um pagamento. `estornado` soma os estornos que não
 * falharam (concluídos e em andamento), para o mesmo valor não ser pedido
 * duas vezes enquanto o Asaas processa.
 */
export function valorDoEstorno(
  pagamento: { valor: number; estornado: number; status: string },
  pedido: number | undefined,
): { valor: number; total: boolean } {
  if (!PAGOS.has(pagamento.status))
    throw new ErroCrm(409, `só dá para estornar pagamento recebido (status: ${pagamento.status})`);
  const restante = centavos(pagamento.valor) - centavos(pagamento.estornado);
  if (restante <= 0) throw new ErroCrm(409, "este pagamento já foi estornado por inteiro");
  const quer = pedido === undefined ? restante : centavos(pedido);
  if (quer <= 0) throw new ErroCrm(400, "valor do estorno precisa ser maior que zero");
  if (quer > restante)
    throw new ErroCrm(
      400,
      `o estorno passa do valor que resta (R$ ${(restante / 100).toFixed(2)})`,
    );
  return { valor: quer / 100, total: quer === restante };
}

function diaAnterior(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type PlanoCancelamento =
  | { imediato: true }
  | { imediato: false; agendadoPara: string; endDate: string };

/**
 * Como cancelar. No fim do ciclo, a assinatura do Asaas ganha `endDate` no
 * dia anterior à próxima cobrança (para ela não ser gerada) e o acesso vai
 * até essa próxima cobrança.
 */
export function planoDeCancelamento(
  a: { status: string; proxima_cobranca: string | null; cancelamento_agendado_para: string | null },
  quando: "fim_do_ciclo" | "agora",
  hoje: string,
): PlanoCancelamento {
  if (a.status === "cancelada") throw new ErroCrm(409, "a assinatura já está cancelada");
  if (quando === "agora") return { imediato: true };
  if (a.cancelamento_agendado_para)
    throw new ErroCrm(409, `o cancelamento já está agendado para ${a.cancelamento_agendado_para}`);
  if (a.status !== "ativa")
    throw new ErroCrm(409, "assinatura inadimplente não tem período pago a manter: cancele agora");
  if (!a.proxima_cobranca || a.proxima_cobranca <= hoje)
    throw new ErroCrm(
      409,
      "sem próxima cobrança futura conhecida: sincronize com o Asaas ou cancele agora",
    );
  return {
    imediato: false,
    agendadoPara: a.proxima_cobranca,
    endDate: diaAnterior(a.proxima_cobranca),
  };
}

// ---------------------------------------------------------------------------
// Uso (insights)
// ---------------------------------------------------------------------------

/** Tamanho do período dos insights de uso (?dias=), 30 por padrão. */
export const DiasUsoSchema = z.coerce
  .number()
  .int()
  .refine((n) => [7, 14, 30, 60, 90].includes(n), "dias deve ser 7, 14, 30, 60 ou 90")
  .default(30);
