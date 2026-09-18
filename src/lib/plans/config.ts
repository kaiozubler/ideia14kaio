// Fonte única de verdade para planos, franquias e preços do MediCopilot.
//
// Usado hoje pela tela pública de contratação (`/planos`). A ideia é que
// qualquer outro ponto que precise saber "quanto custa X" (checkout,
// faturamento dentro do app, tela de upgrade, e-mails de cobrança) importe
// daqui em vez de duplicar números espalhados pelo código.
//
// ⚠️ PREÇOS PLACEHOLDER: os valores abaixo foram estimados a partir da
// conversa de produto para a tela funcionar ponta a ponta. Ajuste livremente
// — a tela inteira recalcula sozinha a partir destes números, sem precisar
// mexer em nenhum componente.

export type TierOption = {
  /** Quantidade incluída neste degrau (ex: 500 conversas de WhatsApp). */
  quantidade: number;
  /** Preço mensal deste degrau (substitui o anterior, não soma). */
  preco: number;
  /** Rótulo opcional exibido no seletor (ex: "Não incluído"). */
  label?: string;
};

export type PlanoBaseId = "basic" | "pro" | "enterprise";

export type PlanoBase = {
  id: PlanoBaseId;
  nome: string;
  descricao: string;
  /** Plano em destaque visual ("Mais escolhido"). */
  destaque?: boolean;
  /** Enterprise: preço é "a partir de" e a config é só um ponto de partida. */
  personalizavel?: boolean;
  /** Preço de pacote fechado — não é recalculado pela fórmula à la carte. */
  precoMensal: number;
  medicos: number;
  secretarias: number;
  copiloto: number;
  whatsapp: number;
  video: number;
};

// ---------------------------------------------------------------------------
// Equipe (usuários médicos custam mais porque usam os recursos mais caros)
// ---------------------------------------------------------------------------

export const EQUIPE_INCLUIDA = { medicos: 1, secretarias: 1 };
export const PRECO_MEDICO_ADICIONAL = 89.9;
export const PRECO_SECRETARIA_ADICIONAL = 39.9;
export const MAX_MEDICOS = 30;
export const MAX_SECRETARIAS = 30;

// ---------------------------------------------------------------------------
// Franquias (o usuário compra "200 consultas de Copiloto", não "R$/token")
// ---------------------------------------------------------------------------

export const TIERS_COPILOTO: TierOption[] = [
  { quantidade: 60, preco: 0 },
  { quantidade: 200, preco: 79.9 },
  { quantidade: 500, preco: 169.9 },
  { quantidade: 1000, preco: 289.9 },
];

export const TIERS_WHATSAPP: TierOption[] = [
  { quantidade: 500, preco: 0 },
  { quantidade: 2000, preco: 49.9 },
  { quantidade: 5000, preco: 99.9 },
  { quantidade: 10000, preco: 179.9 },
];

export const TIERS_VIDEO: TierOption[] = [
  { quantidade: 0, preco: 0, label: "Não incluído" },
  { quantidade: 3000, preco: 59.9 },
  { quantidade: 10000, preco: 129.9 },
  { quantidade: 15000, preco: 179.9 },
];

/** Preço de entrada: 1 médico + 1 secretária + o degrau mais baixo de cada franquia. */
export const PRECO_ENTRADA =
  TIERS_COPILOTO[0].preco + TIERS_WHATSAPP[0].preco + TIERS_VIDEO[0].preco + 149.9;

// ---------------------------------------------------------------------------
// Planos prontos — preço de pacote fechado (mais barato que montar à la carte,
// de propósito, pra incentivar quem não quer personalizar).
// ---------------------------------------------------------------------------

export const PLANOS_BASE: PlanoBase[] = [
  {
    id: "basic",
    nome: "Basic",
    descricao: "O essencial para começar",
    precoMensal: 149.9,
    medicos: 1,
    secretarias: 1,
    copiloto: 60,
    whatsapp: 500,
    video: 0,
  },
  {
    id: "pro",
    nome: "Pro",
    descricao: "Mais recursos para o dia a dia",
    destaque: true,
    precoMensal: 249.9,
    medicos: 1,
    secretarias: 1,
    copiloto: 200,
    whatsapp: 2000,
    video: 3000,
  },
  {
    id: "enterprise",
    nome: "Enterprise",
    descricao: "Para clínicas maiores",
    personalizavel: true,
    precoMensal: 649.9,
    medicos: 2,
    secretarias: 2,
    copiloto: 500,
    whatsapp: 5000,
    video: 10000,
  },
];

// ---------------------------------------------------------------------------
// Pagamento anual
// ---------------------------------------------------------------------------

export const DESCONTO_ANUAL = 0.15; // 15% de desconto pagando anual

// ---------------------------------------------------------------------------
// "Monte seu plano" — preço à la carte
// ---------------------------------------------------------------------------

export type ConfiguracaoPlano = {
  medicos: number;
  secretarias: number;
  copiloto: number;
  whatsapp: number;
  video: number;
};

export const CONFIG_PADRAO: ConfiguracaoPlano = {
  medicos: PLANOS_BASE[0].medicos,
  secretarias: PLANOS_BASE[0].secretarias,
  copiloto: PLANOS_BASE[0].copiloto,
  whatsapp: PLANOS_BASE[0].whatsapp,
  video: PLANOS_BASE[0].video,
};

export function configuracaoDoPlano(plano: PlanoBase): ConfiguracaoPlano {
  return {
    medicos: plano.medicos,
    secretarias: plano.secretarias,
    copiloto: plano.copiloto,
    whatsapp: plano.whatsapp,
    video: plano.video,
  };
}

function precoDoTier(tiers: TierOption[], quantidade: number): number {
  return tiers.find((t) => t.quantidade === quantidade)?.preco ?? 0;
}

/** Preço mensal calculado a partir de uma configuração livre ("monte seu plano"). */
export function calcularPrecoMensal(config: ConfiguracaoPlano): number {
  const medicosExtra = Math.max(0, config.medicos - EQUIPE_INCLUIDA.medicos);
  const secretariasExtra = Math.max(0, config.secretarias - EQUIPE_INCLUIDA.secretarias);

  return (
    149.9 +
    medicosExtra * PRECO_MEDICO_ADICIONAL +
    secretariasExtra * PRECO_SECRETARIA_ADICIONAL +
    precoDoTier(TIERS_COPILOTO, config.copiloto) +
    precoDoTier(TIERS_WHATSAPP, config.whatsapp) +
    precoDoTier(TIERS_VIDEO, config.video)
  );
}

export function precoAnualEquivalenteMensal(precoMensal: number): number {
  return precoMensal * (1 - DESCONTO_ANUAL);
}

export function formatarPreco(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Contato comercial (usado enquanto o checkout self-service não está pronto)
// ---------------------------------------------------------------------------

// TODO: substituir pelo número real do WhatsApp comercial (formato DDI+DDD+número, só dígitos).
export const WHATSAPP_COMERCIAL = "5511999999999";
