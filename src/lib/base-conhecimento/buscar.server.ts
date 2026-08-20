export type IaAlvo = "chat_ai" | "assistente_ai";

/**
 * Monta o bloco de texto da base de conhecimento local do médico para
 * concatenar ao system prompt do chat_ai/assistente_ai.
 *
 * Custo de tokens: sempre inclui só o índice (nome + descrição das bases
 * ativas para essa IA — poucas dezenas de tokens no total). Só inclui o
 * conteúdo de fato quando a busca textual (FTS) encontra trechos relevantes
 * para a mensagem atual (via a função `buscar_base_conhecimento`).
 *
 * Retorna string vazia se o médico não tiver nenhuma base ativa para essa IA
 * (não adiciona nada ao prompt nesse caso — zero custo extra).
 */
export async function montarContextoBaseConhecimento(params: {
  medicoId: string | null;
  mensagem: string;
  ia: IaAlvo;
}): Promise<string> {
  const { medicoId, mensagem, ia } = params;
  if (!medicoId || !mensagem.trim()) return "";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: bases, error: basesErr } = await supabaseAdmin
    .from("base_conhecimento")
    .select("nome, descricao")
    .eq("medico_id", medicoId)
    .eq("ativo", true)
    .contains("ias", [ia]);

  if (basesErr) {
    console.error("[base-conhecimento:buscar] erro ao listar bases:", basesErr.message);
    return "";
  }
  if (!bases || bases.length === 0) return "";

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
  if (hits.length > 0) {
    bloco +=
      `\nTrechos relevantes para esta mensagem:\n` +
      hits.map((t, i) => `[${i + 1}] (base: "${t.base_nome}")\n${t.conteudo}`).join("\n\n") +
      `\n\nINSTRUÇÃO: priorize essas informações ao responder. Ao usá-las, informe explicitamente que a` +
      ` resposta se baseia na base de conhecimento local do médico.`;
  } else {
    bloco +=
      `\nNenhum trecho específico bateu com esta mensagem nas bases acima. Se você responder usando` +
      ` conhecimento geral (não local), informe isso explicitamente (ex.: "não encontrei isso na sua` +
      ` base de conhecimento local, respondendo com conhecimento geral").`;
  }
  return bloco;
}
