import type { ConfiguracaoPlano, PlanoBaseId } from "@/lib/plans/config";
import type { Contato, DadosCliente, Pedido } from "./pedido";

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

export async function atualizarContratacaoRemota(id: string, patch: AtualizarPayload): Promise<void> {
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
