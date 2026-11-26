// Igual em espírito a buscar.server.ts (base de conhecimento por médico),
// mas para a base de conhecimento GLOBAL do produto, usada pelo assistente
// de suporte público (ver supabase/migrations/20260920120000_base_conhecimento_sistema.sql).
//
// O conteúdo vem de docs/ajuda/*.md, sincronizado com a tabela por
// src/lib/ajuda/sincronizar.server.ts (o Assistente IA do app usa a mesma base
// pela tool consultar_faq).

/** Marcador que a IA inclui ao final da resposta se, e somente se, realmente usou
 * algum trecho da base de conhecimento do sistema (mesma lógica de MARCADOR_BASE_LOCAL_USADA,
 * ver buscar.server.ts) — a busca por palavra-chave não entende contexto, quem decide
 * se o trecho é pertinente é a própria IA. */
export const MARCADOR_BASE_SISTEMA_USADA = "[[BASE_SISTEMA_USADA]]";

export type ResultadoContextoBaseSistema = {
  /** Bloco de texto pronto pra concatenar ao system prompt (string vazia se não há conteúdo cadastrado). */
  texto: string;
  /** Verdadeiro se a busca textual achou algum trecho candidato para esta mensagem. */
  temCandidatos: boolean;
};

export async function montarContextoBaseSistema(
  mensagem: string,
): Promise<ResultadoContextoBaseSistema> {
  const vazio: ResultadoContextoBaseSistema = { texto: "", temCandidatos: false };
  if (!mensagem.trim()) return vazio;

  const { buscarAjuda } = await import("@/lib/ajuda/sincronizar.server");
  const hits = await buscarAjuda(mensagem, 4);
  if (hits.length === 0) return vazio;

  const bloco =
    `\n\n=== BASE DE CONHECIMENTO DO PRODUTO (MediCopilot) ===\n` +
    `Trechos candidatos (achados por busca textual — podem não ter relação real com a pergunta,` +
    ` já que essa busca não entende contexto, só palavras em comum):\n` +
    hits.map((t, i) => `[${i + 1}] (${t.titulo})\n${t.conteudo}`).join("\n\n") +
    `\n\nINSTRUÇÃO: avalie você mesmo se algum desses trechos é REALMENTE relevante e responde à` +
    ` pergunta. Se não tiver relação real, ignore-o completamente e responda com seu conhecimento` +
    ` geral sobre o produto, sem mencionar os trechos. Se, e somente se, você efetivamente usou o` +
    ` conteúdo de algum trecho acima na sua resposta, adicione uma última linha, sozinha, exatamente` +
    ` assim, sem mais nada depois dela: ${MARCADOR_BASE_SISTEMA_USADA}`;

  return { texto: bloco, temCandidatos: true };
}
