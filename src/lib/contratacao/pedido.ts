import type { ConfiguracaoPlano, PlanoBaseId } from "@/lib/plans/config";

// Guarda o pedido em andamento no sessionStorage enquanto a pessoa passa
// pelos passos de "Confirme seu plano" → "Meus dados" → "Termo de uso" →
// "Pagamento" → "Conclusão". É só client-side por enquanto (nada é gravado
// no Supabase ainda) — quando entrarmos na etapa de persistir de verdade,
// é aqui que troca por uma chamada de API, sem precisar mexer nas telas.
//
// sessionStorage (não localStorage) de propósito: some sozinho quando a
// aba fecha, então não fica um "pedido fantasma" de uma tentativa antiga se
// a pessoa voltar dias depois — ela recomeça do /planos.

export type Contato = {
  nome: string;
  email: string;
  telefone: string;
};

export type Endereco = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string; // UF
};

export type DadosCliente = {
  nomeClinica: string;
  documento: string; // CPF ou CNPJ, com máscara
  endereco: Endereco;
  /** Contato principal — nome, telefone, e-mail e cargo na clínica. */
  responsavel: Contato & { cargo: string };
  /** true = usa os dados do responsável principal também para o financeiro (recebe NFs/cobrança). */
  financeiroMesmoResponsavel: boolean;
  /** Só usado quando financeiroMesmoResponsavel é false. Permite mais de um contato. */
  financeiro: Contato[];
  /** true = usa os dados do responsável principal também para o jurídico (recebe o termo/contrato). */
  juridicoMesmoResponsavel: boolean;
  /** Só usado quando juridicoMesmoResponsavel é false. Permite mais de um contato. */
  juridico: Contato[];
  especialidade: string;
  pacientesMes: string; // faixa aproximada de pacientes atendidos por mês
  comoConheceu: string; // origem do lead, pra estatística de aquisição
};

export type Pedido = {
  plano: PlanoBaseId;
  config: ConfiguracaoPlano;
  ciclo: "mensal" | "anual";
  /** Dia do mês (1-28) escolhido para as cobranças recorrentes seguintes. Só faz sentido no ciclo mensal. */
  diaCobranca?: number;
  dados?: DadosCliente;
  termosAceitos?: boolean;
};

const CHAVE = "medicopilot:pedido";

export function salvarPedido(pedido: Pedido) {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(pedido));
  } catch {
    // sessionStorage indisponível (modo privado restritivo etc.) — o fluxo
    // segue, só perde a continuidade entre passos nesse caso raro.
  }
}

export function lerPedido(): Pedido | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as Pedido) : null;
  } catch {
    return null;
  }
}

export function atualizarPedido(parcial: Partial<Pedido>): Pedido | null {
  const atual = lerPedido();
  if (!atual) return null;
  const novo = { ...atual, ...parcial };
  salvarPedido(novo);
  return novo;
}

export function limparPedido() {
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    // ver comentário em salvarPedido
  }
}
