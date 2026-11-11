// Regras da Pipe do Zubler CRM que não dependem do Supabase: funis e etapas,
// posição automática de cada card, health score e o schema da gravação.
// Testes em tests/crm-pipe.test.ts.

import { z } from "zod";

export const ETAPAS = {
  leads: ["cadastro", "contratando", "aguardando-pagamento", "pago"],
  onboarding: ["kickoff", "setup", "capacitacao", "validacao", "checkout"],
  ongoing: ["ativacao", "customer-success", "expansao", "renovacao", "risco", "sucesso"],
} as const;

export type Funil = keyof typeof ETAPAS;
export type Posicao = { funil: Funil; etapa: string };

/** Fase do cliente pelos dados do app: ainda é lead ou já é cliente pagante. */
export type Fase = "lead" | "cliente";

export const DIAS_ONBOARDING = 30;
const DIA = 86_400_000;

export type SituacaoClinica = {
  /** status da assinatura vigente ou da mais recente; null = nunca assinou */
  assinatura: "ativa" | "inadimplente" | "cancelada" | null;
  assinatura_desde: string | null;
};

export type SituacaoContratacao = {
  status: string;
  pago: boolean;
};

export function faseDaClinica(s: SituacaoClinica): Fase {
  return s.assinatura === "ativa" || s.assinatura === "inadimplente" ? "cliente" : "lead";
}

/** Onde o card cai quando a equipe ainda não o moveu. */
export function posicaoAutomaticaClinica(s: SituacaoClinica, agora = Date.now()): Posicao {
  if (faseDaClinica(s) === "lead") return { funil: "leads", etapa: "cadastro" };
  if (s.assinatura === "inadimplente") return { funil: "ongoing", etapa: "risco" };
  const desde = s.assinatura_desde ? Date.parse(s.assinatura_desde) : NaN;
  if (Number.isFinite(desde) && agora - desde < DIAS_ONBOARDING * DIA)
    return { funil: "onboarding", etapa: "kickoff" };
  return { funil: "ongoing", etapa: "customer-success" };
}

export function posicaoAutomaticaContratacao(s: SituacaoContratacao): Posicao {
  if (s.pago) return { funil: "leads", etapa: "pago" };
  if (s.status === "aguardando_confirmacao")
    return { funil: "leads", etapa: "aguardando-pagamento" };
  return { funil: "leads", etapa: "contratando" };
}

export function posicaoValida(funil: unknown, etapa: unknown): funil is Funil {
  return (
    typeof funil === "string" &&
    funil in ETAPAS &&
    (ETAPAS[funil as Funil] as readonly string[]).includes(String(etapa))
  );
}

/**
 * Posição salva pela equipe, se ainda combina com a fase do cliente: um lead
 * que assinou sai do funil de leads sozinho, e um cliente que cancelou volta
 * para a posição automática.
 */
export function posicaoFinal(
  fase: Fase,
  automatica: Posicao,
  salva: { funil: string | null; etapa: string | null } | null,
): Posicao {
  if (!salva || !posicaoValida(salva.funil, salva.etapa)) return automatica;
  const salvaEhLead = salva.funil === "leads";
  if (salvaEhLead !== (fase === "lead")) return automatica;
  return { funil: salva.funil as Funil, etapa: salva.etapa as string };
}

/** Dias desde a data (null se não houver data). */
export function diasDesde(iso: string | null | undefined, agora = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / DIA)) : null;
}

/**
 * Health score 0–100: uso recente (último login da clínica inteira) pesa
 * mais; inadimplência, cobranças vencidas e acesso bloqueado derrubam.
 */
export function healthScore(s: {
  dias_sem_login: number | null;
  inadimplente: boolean;
  cobrancas_vencidas: number;
  acesso_bloqueado: boolean;
  membros: number;
}): number {
  const d = s.dias_sem_login;
  let hs =
    d == null ? 20 : d <= 2 ? 100 : d <= 7 ? 85 : d <= 14 ? 70 : d <= 30 ? 50 : d <= 60 ? 30 : 15;
  if (s.membros > 0) hs += 5;
  if (s.inadimplente) hs -= 35;
  hs -= Math.min(s.cobrancas_vencidas, 3) * 10;
  if (s.acesso_bloqueado) hs -= 30;
  return Math.max(0, Math.min(100, hs));
}

/** Engajamento pelo último uso: engajado até 7 dias, morno até 30, frio depois. */
export function engajamento(dias: number | null): "engaged" | "warm" | "cold" {
  if (dias == null) return "cold";
  return dias <= 7 ? "engaged" : dias <= 30 ? "warm" : "cold";
}

// ---------------------------------------------------------------------------
// Gravação vinda do CRM
// ---------------------------------------------------------------------------

const textoOuNulo = (max: number) => z.string().trim().max(max).nullable().optional();

export const LostSchema = z.object({
  reason: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD"),
  fine: z.coerce.number().min(0).max(10_000_000).default(0),
  pendingBills: z.coerce.number().int().min(0).max(1000).default(0),
  pendingAmount: z.coerce.number().min(0).max(10_000_000).default(0),
  notes: textoOuNulo(2000),
});

export const PipePatchSchema = z
  .object({
    tipo: z.enum(["clinica", "contratacao"]),
    funil: z.enum(["leads", "onboarding", "ongoing"]).optional(),
    etapa: z.string().trim().max(40).optional(),
    responsavel: z.string().trim().toLowerCase().email().max(255).nullable().optional(),
    lost: LostSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (d) => (d.funil === undefined) === (d.etapa === undefined),
    "informe funil e etapa juntos",
  )
  .refine(
    (d) => d.funil === undefined || posicaoValida(d.funil, d.etapa),
    "etapa não existe nesse funil",
  )
  .refine(
    (d) => d.funil !== undefined || d.responsavel !== undefined || d.lost !== undefined,
    "nada para salvar",
  );
