export type IaAlvo = "chat_ai" | "assistente_ai";

/** Marcador que a IA deve incluir ao final da resposta se, e somente se, ela
 * realmente usou o conteúdo da base de conhecimento local. A busca por
 * palavra-chave (FTS) não entende contexto — ela pode trazer um trecho que
 * compartilha vocabulário com a pergunta sem ter relação real com o assunto
 * (ex.: pergunta genérica sobre arritmia batendo com um guia de canabinoides
 * que menciona "coração" ao discutir riscos cardiovasculares). A IA, que
 * entende o contexto, é quem decide se aquele trecho é realmente pertinente;
 * o marcador é como ela comunica essa decisão de volta pro código, sem
 * precisar de uma segunda chamada. Ver chat-ia.ts/assistente-ia.ts, onde o
 * marcador é lido e removido do texto antes de exibir ao usuário. */
export const MARCADOR_BASE_LOCAL_USADA = "[[BASE_LOCAL_USADA]]";

export type ResultadoContextoBaseConhecimento = {
  /** Bloco de texto pronto pra concatenar ao system prompt (string vazia se não há bases ativas). */
  texto: string;
  /** Nomes das bases cujo conteúdo foi injetado como CANDIDATO (a busca por palavra-chave achou
   * alguma relação com a mensagem) — isso NÃO significa que a IA considerou o conteúdo relevante ou
   * o usou de fato. Para saber se foi realmente usado, confira se a resposta contém
   * MARCADOR_BASE_LOCAL_USADA. */
  basesCandidatas: string[];
};

/**
 * Monta o bloco de texto da base de conhecimento local do médico para
 * concatenar ao system prompt do chat_ai/assistente_ai, e lista as bases
 * candidatas (achadas pela busca textual) — a confirmação de uso real vem da
 * própria IA, via MARCADOR_BASE_LOCAL_USADA.
 *
 * Custo de tokens: sempre inclui só o índice (nome + descrição das bases
 * ativas para essa IA — poucas dezenas de tokens no total). Só inclui o
 * conteúdo de fato quando a busca textual (FTS) encontra trechos candidatos
 * para a mensagem atual (via a função `buscar_base_conhecimento`).
 *
 * Retorna texto vazio se o médico não tiver nenhuma base ativa para essa IA
 * (não adiciona nada ao prompt nesse caso — zero custo extra).
 */
export async function montarContextoBaseConhecimento(params: {
  medicoId: string | null;
  mensagem: string;
  ia: IaAlvo;
}): Promise<ResultadoContextoBaseConhecimento> {
  const vazio: ResultadoContextoBaseConhecimento = { texto: "", basesCandidatas: [] };
  const { medicoId, mensagem, ia } = params;
  if (!medicoId || !mensagem.trim()) return vazio;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: bases, error: basesErr } = await supabaseAdmin
    .from("base_conhecimento")
    .select("nome, descricao")
    .eq("medico_id", medicoId)
    .eq("ativo", true)
    .contains("ias", [ia]);

  if (basesErr) {
    console.error("[base-conhecimento:buscar] erro ao listar bases:", basesErr.message);
    return vazio;
  }
  if (!bases || bases.length === 0) return vazio;

  const indice = bases.map((b) => `- "${b.nome}"${b.descricao ? ` — ${b.descricao}` : ""}`).join("\n");

  const { data: trechos, error: trechosErr } = await supabaseAdmin.rpc("buscar_base_conhecimento", {
    p_medico_id: medicoId,
    p_mensagem: mensagem,
    p_ia: ia,
    p_limit: 4,
  });
  if (trechosErr) {
    console.error("[base-conhecimento:buscar] erro na busca textual:", trechosErr.message);
  }

  let bloco =
    `\n\n=== BASE DE CONHECIMENTO LOCAL DO MÉDICO ===\n` + `Bases ativas cadastradas por este médico:\n${indice}\n`;

  const hits = (trechos ?? []) as { base_nome: string; conteudo: string }[];
  let basesCandidatas: string[] = [];
  if (hits.length > 0) {
    basesCandidatas = Array.from(new Set(hits.map((h) => h.base_nome)));
    bloco +=
      `\nTrechos candidatos (achados por busca textual — podem não ter relação real com a pergunta,` +
      ` já que essa busca não entende contexto, só palavras em comum):\n` +
      hits.map((t, i) => `[${i + 1}] (base: "${t.base_nome}")\n${t.conteudo}`).join("\n\n") +
      `\n\nINSTRUÇÃO: avalie você mesmo se algum desses trechos é REALMENTE relevante e responde à` +
      ` pergunta do médico. Se o assunto não tiver relação real com o que foi perguntado, ignore-o` +
      ` completamente e responda com seu conhecimento geral, sem mencionar os trechos.` +
      ` Se, e somente se, você efetivamente usou o conteúdo de algum trecho acima na sua resposta,` +
      ` adicione uma última linha, sozinha, exatamente assim, sem mais nada depois dela:` +
      ` ${MARCADOR_BASE_LOCAL_USADA}`;
  } else {
    bloco +=
      `\nNenhum trecho candidato encontrado para esta mensagem nas bases acima. Responda com seu` +
      ` conhecimento geral, sem mencionar a base de conhecimento local.`;
  }
  return { texto: bloco, basesCandidatas };
}
