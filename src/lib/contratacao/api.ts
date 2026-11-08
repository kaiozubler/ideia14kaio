import type { ConfiguracaoPlano, PlanoBaseId } from "@/lib/plans/config";
import type { Contato, CupomDoPedido, DadosCliente, Pedido } from "./pedido";

// Espelha o pedido (que já vive no sessionStorage — ver pedido.ts) na tabela
// `contratacoes` do Supabase, via /api/contratacao. Nunca lança erro pra
// quem chama: se a gravação falhar (rede, servidor fora, etc.), a pessoa
// continua o fluxo normalmente — isso é só um espelho, não a fonte da UI.

type CriarPayload = {
  plano: PlanoBaseId;
  config: ConfiguracaoPlano;
  ciclo: "mensal" | "anual";
  diaCobranca?: number;
  precoMensalCalculado: number;
};

export async function criarContratacaoRemota(dados: CriarPayload): Promise<string | null> {
  try {
    const resp = await fetch("/api/contratacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plano: dados.plano,
        ...dados.config,
        ciclo: dados.ciclo,
        diaCobranca: dados.diaCobranca ?? null,
        precoMensalCalculado: dados.precoMensalCalculado,
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

type AtualizarPayload = Partial<{
  plano: PlanoBaseId;
  config: ConfiguracaoPlano;
  ciclo: "mensal" | "anual";
  diaCobranca: number | null;
  precoMensalCalculado: number;
  nomeClinica: string;
  documento: string;
  endereco: DadosCliente["endereco"];
  responsavel: DadosCliente["responsavel"];
  financeiroMesmoResponsavel: boolean;
  financeiro: Contato[];
  juridicoMesmoResponsavel: boolean;
  juridico: Contato[];
  especialidade: string;
  pacientesMes: string;
  comoConheceu: string;
  termosAceitos: boolean;
  status: "em_andamento" | "aguardando_confirmacao" | "confirmada" | "cancelada";
}>;

export async function atualizarContratacaoRemota(
  id: string,
  patch: AtualizarPayload,
): Promise<void> {
  try {
    const { config, ...resto } = patch;
    await fetch("/api/contratacao", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...resto, ...config }),
    });
  } catch {
    // silencioso de propósito — ver comentário no topo do arquivo.
  }
}

/**
 * Aplica (ou remove, com codigo null) um cupom na contratação. Diferente das
 * outras chamadas daqui, devolve o erro: o cliente precisa saber por que o
 * cupom não vale.
 */
export function aplicarCupomRemoto(id: string, codigo: string | null): Promise<RespostaCupom> {
  return chamarCupom({ id, codigo });
}

/** Só confere o cupom para um plano ainda não salvo (página /planos). Não grava nada. */
export function previaCupomRemoto(
  pedido: { plano: PlanoBaseId; config: ConfiguracaoPlano; ciclo: "mensal" | "anual" },
  codigo: string,
): Promise<RespostaCupom> {
  return chamarCupom({
    previa: { plano: pedido.plano, ...pedido.config, ciclo: pedido.ciclo },
    codigo,
  });
}

export type RespostaCupom = { cupom: CupomDoPedido | null } | { erro: string };

async function chamarCupom(corpo: unknown): Promise<RespostaCupom> {
  try {
    const resp = await fetch("/api/contratacao/cupom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      cupom?: CupomDoPedido | null;
      error?: string;
    };
    if (!resp.ok) return { erro: data.error || "Não foi possível conferir o cupom agora." };
    return { cupom: data.cupom ?? null };
  } catch {
    return { erro: "Não foi possível conferir o cupom agora. Confira sua conexão." };
  }
}

/** Garante que o pedido tem um contratacaoId, criando a linha remota se ainda não existir; devolve o pedido atualizado. */
export async function garantirContratacaoRemota(
  pedido: Pedido,
  precoMensalCalculado: number,
): Promise<{ contratacaoId: string | undefined }> {
  if (pedido.contratacaoId) {
    await atualizarContratacaoRemota(pedido.contratacaoId, {
      plano: pedido.plano,
      config: pedido.config,
      ciclo: pedido.ciclo,
      diaCobranca: pedido.diaCobranca ?? null,
      precoMensalCalculado,
    });
    return { contratacaoId: pedido.contratacaoId };
  }
  const id = await criarContratacaoRemota({
    plano: pedido.plano,
    config: pedido.config,
    ciclo: pedido.ciclo,
    diaCobranca: pedido.diaCobranca,
    precoMensalCalculado,
  });
  return { contratacaoId: id ?? undefined };
}
