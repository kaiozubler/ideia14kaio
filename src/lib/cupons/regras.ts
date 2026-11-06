// Cupons de desconto da contratação do MediCopilot. Criados e editados no
// Zubler CRM (pela ponte /api/public/crm/cupons) e aplicados na contratação.
//
// Fica sem Supabase de propósito, para os testes (tests/cupons.test.ts)
// rodarem sem banco: o schema valida o que o CRM manda e `aplicarCupom`
// decide, para um pedido, se o cupom vale e o que ele dá.
//
// Tipos de benefício:
//   percentual         X% de desconto na mensalidade (100% = uso bonificado)
//   valor              R$ X de desconto na mensalidade (nunca abaixo de zero)
//   teste_gratis       X dias grátis antes da primeira cobrança
//   recurso_adicional  X unidades extras por mês de um recurso do plano
//                      (consultas de Copiloto, conversas de WhatsApp, minutos
//                      de vídeo, médicos, secretárias ou o Copiloto ativo)
//
// Duração (`duracao_meses`): null = vitalício (vale enquanto a assinatura
// existir); N = vale nas N primeiras mensalidades. Não se aplica ao teste
// grátis, que já é medido em dias.

import { z } from "zod";
import { PLANOS_BASE, type PlanoBaseId } from "../plans/config.ts";

export const TIPOS_CUPOM = ["percentual", "valor", "teste_gratis", "recurso_adicional"] as const;
export type TipoCupom = (typeof TIPOS_CUPOM)[number];

export const RECURSOS_BONUS = [
  "copiloto",
  "whatsapp",
  "video",
  "medicos",
  "secretarias",
  "copiloto_ativo",
] as const;
export type RecursoBonus = (typeof RECURSOS_BONUS)[number];

const PLANO_IDS = PLANOS_BASE.map((p) => p.id) as [PlanoBaseId, ...PlanoBaseId[]];

/** O nome do cupom é o código que o cliente digita: maiúsculo, sem espaço. */
export function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase();
}

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD")
  .nullable()
  .optional();

const camposCupom = {
  descricao: z.string().trim().max(300).nullable().optional(),
  tipo: z.enum(TIPOS_CUPOM),
  valor: z.coerce.number().positive("o valor precisa ser maior que zero"),
  recurso: z.enum(RECURSOS_BONUS).nullable().optional(),
  /** Vazio = qualquer plano. */
  planos: z.array(z.enum(PLANO_IDS)).max(PLANO_IDS.length).default([]),
  /** null = mensal ou anual. */
  ciclo: z.enum(["mensal", "anual"]).nullable().optional(),
  /** null = vitalício. */
  duracao_meses: z.coerce.number().int().min(1).max(120).nullable().optional(),
  valido_de: data,
  valido_ate: data,
  limite_usos: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  ativo: z.boolean().default(true),
};

const codigo = z
  .string()
  .transform(normalizarCodigo)
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/, "use de 3 a 40 letras, números, - ou _ (sem espaços)"),
  );

type CupomBase = z.infer<z.ZodObject<typeof camposCupom>>;

/** Regras que dependem de mais de um campo. */
function regrasCruzadas(c: CupomBase, ctx: z.RefinementCtx) {
  const erro = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (c.tipo === "percentual" && c.valor > 100) erro("valor", "a porcentagem vai até 100%");
  if (c.tipo === "valor" && c.valor > 100_000) erro("valor", "desconto acima de R$ 100.000");
  if (c.tipo === "teste_gratis") {
    if (!Number.isInteger(c.valor) || c.valor > 365) erro("valor", "o teste vai de 1 a 365 dias");
    if (c.duracao_meses != null) erro("duracao_meses", "o teste grátis já é medido em dias");
  }
  if (c.tipo === "recurso_adicional") {
    if (!c.recurso) erro("recurso", "escolha o recurso que o cupom libera");
    else if (c.recurso !== "copiloto_ativo" && (!Number.isInteger(c.valor) || c.valor > 100_000))
      erro("valor", "a quantidade adicional vai de 1 a 100.000");
    // Copiloto ativo: já vem no Pro e não existe no Basic; só é adicional no Enterprise.
    if (c.recurso === "copiloto_ativo" && (c.planos.length !== 1 || c.planos[0] !== "enterprise"))
      erro("planos", "Copiloto ativo grátis só vale para o plano Enterprise");
  } else if (c.recurso) {
    erro("recurso", "recurso só vale para cupom de recurso adicional");
  }
  if (c.valido_de && c.valido_ate && c.valido_ate < c.valido_de)
    erro("valido_ate", "o fim da validade é antes do início");
}

export const CupomNovoSchema = z
  .object({ codigo, ...camposCupom })
  .strict()
  .superRefine(regrasCruzadas);

/** Edição: qualquer campo menos o nome (o código já pode ter sido divulgado). */
export const CupomPatchSchema = z
  .object(Object.fromEntries(Object.entries(camposCupom).map(([k, v]) => [k, v.optional()])))
  .strict()
  .refine((d) => Object.keys(d).length > 0, "informe ao menos um campo");

/** Revalida o cupom inteiro depois de juntar a edição com o que já está salvo. */
export const CupomCompletoSchema = z.object(camposCupom).superRefine(regrasCruzadas);

export type Cupom = z.infer<typeof CupomNovoSchema> & { id?: string };

// ---------------------------------------------------------------------------
// Aplicação na contratação
// ---------------------------------------------------------------------------

export type PedidoCupom = {
  plano: string;
  ciclo: "mensal" | "anual";
  /** Mensalidade do pedido antes do cupom. */
  precoMensal: number;
};

export type ResultadoCupom =
  | { ok: false; motivo: string }
  | {
      ok: true;
      tipo: TipoCupom;
      /** Quanto sai da mensalidade (0 para teste grátis e recurso adicional). */
      descontoMensal: number;
      precoMensalComDesconto: number;
      /** Mensalidades com o benefício; null = vitalício. */
      meses: number | null;
      diasTeste: number;
      bonus: { recurso: RecursoBonus; quantidade: number } | null;
      /** Desconto total: o cliente usa sem pagar (bonificação). */
      bonificado: boolean;
    };

const centavos = (v: number) => Math.round(v * 100) / 100;

function hojeIso(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}

/**
 * Decide se o cupom vale para o pedido e calcula o benefício. `usos` é
 * quantas contratações já usaram o cupom (para o limite de usos).
 */
export function aplicarCupom(
  cupom: Cupom,
  pedido: PedidoCupom,
  { agora = new Date(), usos = 0 }: { agora?: Date; usos?: number } = {},
): ResultadoCupom {
  const hoje = hojeIso(agora);
  if (!cupom.ativo) return { ok: false, motivo: "Este cupom não está mais ativo." };
  if (cupom.valido_de && hoje < cupom.valido_de)
    return { ok: false, motivo: "Este cupom ainda não está valendo." };
  if (cupom.valido_ate && hoje > cupom.valido_ate)
    return { ok: false, motivo: "Este cupom expirou." };
  if (cupom.limite_usos != null && usos >= cupom.limite_usos)
    return { ok: false, motivo: "Este cupom já atingiu o limite de usos." };
  if (cupom.planos.length > 0 && !cupom.planos.includes(pedido.plano as PlanoBaseId)) {
    const nomes = cupom.planos.map((id) => PLANOS_BASE.find((p) => p.id === id)?.nome ?? id);
    return { ok: false, motivo: `Este cupom vale só para o plano ${nomes.join(" ou ")}.` };
  }
  if (cupom.ciclo && cupom.ciclo !== pedido.ciclo)
    return { ok: false, motivo: `Este cupom vale só para pagamento ${cupom.ciclo}.` };

  const preco = Math.max(0, pedido.precoMensal);
  let desconto = 0;
  if (cupom.tipo === "percentual") desconto = centavos((preco * Math.min(cupom.valor, 100)) / 100);
  if (cupom.tipo === "valor") desconto = centavos(Math.min(cupom.valor, preco));
  const final = centavos(preco - desconto);

  return {
    ok: true,
    tipo: cupom.tipo,
    descontoMensal: desconto,
    precoMensalComDesconto: final,
    meses: cupom.tipo === "teste_gratis" ? null : (cupom.duracao_meses ?? null),
    diasTeste: cupom.tipo === "teste_gratis" ? cupom.valor : 0,
    bonus:
      cupom.tipo === "recurso_adicional" && cupom.recurso
        ? {
            recurso: cupom.recurso,
            quantidade: cupom.recurso === "copiloto_ativo" ? 1 : cupom.valor,
          }
        : null,
    bonificado: (cupom.tipo === "percentual" || cupom.tipo === "valor") && final === 0,
  };
}
