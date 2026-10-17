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
