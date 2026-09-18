// Fonte única de verdade para planos, franquias e preços do MediCopilot.
//
// Usado hoje pela tela pública de contratação (`/planos`) e pelo resumo de
// checkout (`/checkout`). Qualquer outro ponto que precise saber "quanto
// custa X" deve importar daqui em vez de duplicar números espalhados pelo
// código.
//
// ⚠️ PREÇOS PLACEHOLDER: os valores abaixo foram estimados a partir da
// conversa de produto para a tela funcionar ponta a ponta. Ajuste livremente.
//
// MODELO DE PREÇO: cada plano pronto (Basic/Pro/Enterprise) tem um preço de
// pacote fechado (`precoMensal`). A partir do momento em que a pessoa mexe
// nos contadores/seletores do "monte seu plano", o preço passa a ser esse
// preço de pacote MAIS/MENOS a diferença (delta) de cada item em relação ao
// que já vinha incluído naquele plano — ou seja, cada ajuste soma (ou
// desconta) do valor mensal na hora, sem recalcular tudo do zero.

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
  /** Preço de pacote fechado deste plano, com a config abaixo já incluída. */
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

// Estes dois valores foram calibrados de propósito: personalizar um plano
// menor até chegar nas mesmas licenças + franquias do Enterprise precisa
// custar pelo menos 10% A MAIS que o preço de pacote do Enterprise — senão
// vira um jeito de "burlar" o plano fechado montando ele à la carte por
// menos. Se mudar os preços dos planos prontos ou das franquias, revalide
// essa conta com precoDaConfiguracao(configuracaoDoPlano(PLANOS_BASE[2]), PLANOS_BASE[1])
// — o resultado tem que ficar acima de PLANOS_BASE[2].precoMensal * 1.1.
export const PRECO_MEDICO_ADICIONAL = 179.9;
export const PRECO_SECRETARIA_ADICIONAL = 79.9;
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

// ---------------------------------------------------------------------------
// Planos prontos — preço de pacote fechado (mais barato que montar à la
// carte, de propósito, pra incentivar quem não quer personalizar).
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

export const PLANO_PADRAO = PLANOS_BASE[0];

// ---------------------------------------------------------------------------
// "Personalizado" — só aparece nos seletores quando o plano Enterprise está
// ativo. Sinaliza que aquele item vai a cotação (sem preço fixo), então o
// CTA principal vira "Falar com nosso especialista" em vez de ir pra
// pagamento com um valor calculado.
// ---------------------------------------------------------------------------

export const PERSONALIZADO = -1;

export const OPCAO_PERSONALIZADO: TierOption = {
  quantidade: PERSONALIZADO,
  preco: 0,
  label: "Personalizado",
};

/** Acrescenta a opção "Personalizado" à lista de tiers, só quando permitido (Enterprise). */
export function opcoesComPersonalizado(tiers: TierOption[], permitir: boolean): TierOption[] {
  return permitir ? [...tiers, OPCAO_PERSONALIZADO] : tiers;
}

/** Verdadeiro se algum item da configuração está marcado como "Personalizado" (precisa de cotação). */
export function possuiItemPersonalizado(config: ConfiguracaoPlano): boolean {
  return (
    config.copiloto === PERSONALIZADO ||
    config.whatsapp === PERSONALIZADO ||
    config.video === PERSONALIZADO
  );
}

// ---------------------------------------------------------------------------
// Pagamento anual
// ---------------------------------------------------------------------------

export const DESCONTO_ANUAL = 0.15; // 15% de desconto pagando anual

// ---------------------------------------------------------------------------
// "Monte seu plano" — preço = pacote da âncora + soma dos ajustes
// ---------------------------------------------------------------------------

export type ConfiguracaoPlano = {
  medicos: number;
  secretarias: number;
  copiloto: number;
  whatsapp: number;
  video: number;
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

/** Verdadeiro se a configuração atual já é exatamente a de fábrica da âncora. */
export function configuracaoIgualAncora(config: ConfiguracaoPlano, ancora: PlanoBase): boolean {
  return (
    config.medicos === ancora.medicos &&
    config.secretarias === ancora.secretarias &&
    config.copiloto === ancora.copiloto &&
    config.whatsapp === ancora.whatsapp &&
    config.video === ancora.video
  );
}

/**
 * Preço mensal = preço de pacote da âncora + a diferença de cada item em
 * relação ao que já vinha incluído nela. Cada clique em "+"/"-" ou troca de
 * franquia soma (ou desconta) direto no total, na hora.
 */
export function precoDaConfiguracao(
  config: ConfiguracaoPlano,
  ancora: PlanoBase = PLANO_PADRAO,
): number {
  const deltaMedicos = (config.medicos - ancora.medicos) * PRECO_MEDICO_ADICIONAL;
  const deltaSecretarias = (config.secretarias - ancora.secretarias) * PRECO_SECRETARIA_ADICIONAL;
  const deltaCopiloto = precoDoTier(TIERS_COPILOTO, config.copiloto) - precoDoTier(TIERS_COPILOTO, ancora.copiloto);
  const deltaWhatsapp = precoDoTier(TIERS_WHATSAPP, config.whatsapp) - precoDoTier(TIERS_WHATSAPP, ancora.whatsapp);
  const deltaVideo = precoDoTier(TIERS_VIDEO, config.video) - precoDoTier(TIERS_VIDEO, ancora.video);

  return ancora.precoMensal + deltaMedicos + deltaSecretarias + deltaCopiloto + deltaWhatsapp + deltaVideo;
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
