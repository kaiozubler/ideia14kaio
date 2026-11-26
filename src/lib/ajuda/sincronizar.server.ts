// Mantém `base_conhecimento_sistema_itens` igual a docs/ajuda/*.md.
//
// O Markdown entra no bundle do servidor no build; na primeira consulta de cada
// instância comparamos os hashes com o banco e gravamos só o que mudou (e
// desativamos o que saiu). Assim, publicar o app já publica o FAQ, sem script
// nem acesso manual ao banco.

import { lerBaseAjuda, linhaDoItem, planejarSincronizacao } from "./conteudo";

const ARQUIVOS = import.meta.glob("/docs/ajuda/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

let emAndamento: Promise<void> | null = null;

async function sincronizar(): Promise<void> {
  const { temas, erros } = lerBaseAjuda(ARQUIVOS);
  for (const e of erros) console.warn(`[ajuda] ${e.arquivo}: ${e.mensagem}`);
  const itens = temas.flatMap((t) => t.itens);
  if (!itens.length) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Colunas novas (chave/hash/origem) podem ainda não estar no arquivo de tipos gerado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabela = () => (supabaseAdmin as any).from("base_conhecimento_sistema_itens");

  const { data, error } = await tabela().select("chave,hash,ativo").eq("origem", "ajuda");
  if (error) throw new Error(error.message);

  const { gravar, desativar } = planejarSincronizacao(itens, data ?? []);
  if (gravar.length) {
    const agora = new Date().toISOString();
    const { error: e } = await tabela().upsert(
      gravar.map((it) => ({ ...linhaDoItem(it), updated_at: agora })),
      { onConflict: "chave" },
    );
    if (e) throw new Error(e.message);
  }
  if (desativar.length) {
    const { error: e } = await tabela()
      .update({ ativo: false })
      .eq("origem", "ajuda")
      .in("chave", desativar);
    if (e) throw new Error(e.message);
  }
  if (gravar.length || desativar.length) {
    console.info(
      `[ajuda] base sincronizada: ${gravar.length} gravado(s), ${desativar.length} desativado(s)`,
    );
  }
}

/** Garante a base sincronizada uma vez por instância. Falha não bloqueia a busca:
 * o assistente segue com o que já estiver no banco e a próxima chamada tenta de novo. */
export async function garantirBaseAjuda(): Promise<void> {
  if (!emAndamento) {
    emAndamento = sincronizar().catch((err) => {
      console.error(
        "[ajuda] falha ao sincronizar a base:",
        err instanceof Error ? err.message : err,
      );
      emAndamento = null;
    });
  }
  await emAndamento;
}

export type TrechoAjuda = { titulo: string; conteudo: string };

/** Busca as perguntas da base de ajuda mais próximas do texto. */
export async function buscarAjuda(pergunta: string, limite = 4): Promise<TrechoAjuda[]> {
  const texto = pergunta.trim();
  if (!texto) return [];
  await garantirBaseAjuda();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc("buscar_base_conhecimento_sistema", {
    p_mensagem: texto,
    p_limit: limite,
  });
  if (error) {
    console.error("[ajuda] erro na busca:", error.message);
    return [];
  }
  return ((data ?? []) as TrechoAjuda[]).map((t) => ({ titulo: t.titulo, conteudo: t.conteudo }));
}
