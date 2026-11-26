// Base de ajuda do produto (docs/ajuda/*.md) → itens de `base_conhecimento_sistema_itens`.
//
// Puro (sem imports): usado pelo servidor (sincronizar.server.ts), pelo script
// de rotina (scripts/base-ajuda.mjs) e pelos testes. O formato está descrito em
// docs/ajuda/README.md: cada arquivo é um tema, cada "## " é uma pergunta.

export type TemaAjuda = {
  /** Nome do arquivo sem extensão (ex.: "agenda"). */
  arquivo: string;
  titulo: string;
  /** Prefixos de caminho do código que, se mudarem, podem desatualizar o tema. */
  fontes: string[];
  itens: ItemAjuda[];
};

export type ItemAjuda = {
  /** Identificador estável: "<arquivo>#<pergunta em slug>". */
  chave: string;
  /** Título do tema (área do app). */
  categoria: string;
  pergunta: string;
  /** Sinônimos e termos que o usuário costuma usar. */
  palavras: string[];
  resposta: string;
  ordem: number;
  /** Hash do conteúdo, para gravar só o que mudou. */
  hash: string;
};

export type ErroAjuda = { arquivo: string; mensagem: string };

export function slugAjuda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** cyrb53: hash rápido e estável (não criptográfico), suficiente para detectar mudança. */
export function hashAjuda(texto: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function lerFrontmatter(texto: string): { campos: Record<string, string>; corpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(texto);
  if (!m) return { campos: {}, corpo: texto };
  const campos: Record<string, string> = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const i = linha.indexOf(":");
    if (i > 0) campos[linha.slice(0, i).trim().toLowerCase()] = linha.slice(i + 1).trim();
  }
  return { campos, corpo: texto.slice(m[0].length) };
}

const lista = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Lê um arquivo de tema. `arquivo` é o nome sem extensão. */
export function lerTemaAjuda(
  arquivo: string,
  texto: string,
): { tema: TemaAjuda; erros: ErroAjuda[] } {
  const erros: ErroAjuda[] = [];
  const { campos, corpo } = lerFrontmatter(texto.replace(/^\uFEFF/, ""));
  const titulo = campos["titulo"] || arquivo;
  if (!campos["titulo"]) erros.push({ arquivo, mensagem: "frontmatter sem 'titulo'" });

  const itens: ItemAjuda[] = [];
  const vistas = new Set<string>();
  // Divide em seções "## "; o que vem antes da primeira pergunta é ignorado.
  const secoes = corpo.split(/^## +/m).slice(1);
  secoes.forEach((secao, i) => {
    const [primeira, ...resto] = secao.split(/\r?\n/);
    const pergunta = primeira.trim();
    let linhas = resto;
    let palavras: string[] = [];
    const idx = linhas.findIndex((l) => l.trim() !== "");
    if (idx >= 0 && /^palavras\s*:/i.test(linhas[idx].trim())) {
      palavras = lista(linhas[idx].trim().replace(/^palavras\s*:/i, ""));
      linhas = linhas.slice(idx + 1);
    }
    const resposta = linhas.join("\n").trim();
    const chave = `${arquivo}#${slugAjuda(pergunta)}`;
    if (!pergunta) erros.push({ arquivo, mensagem: `pergunta ${i + 1} sem título` });
    if (!resposta) erros.push({ arquivo, mensagem: `"${pergunta}" sem resposta` });
    if (vistas.has(chave)) {
      erros.push({ arquivo, mensagem: `pergunta repetida: "${pergunta}"` });
      return;
    }
    vistas.add(chave);
    if (!pergunta || !resposta) return;
    itens.push({
      chave,
      categoria: titulo,
      pergunta,
      palavras,
      resposta,
      ordem: i,
      hash: hashAjuda(JSON.stringify([titulo, pergunta, palavras, resposta, i])),
    });
  });
  if (!itens.length && !erros.length)
    erros.push({ arquivo, mensagem: "nenhuma pergunta (use '## ')" });

  return { tema: { arquivo, titulo, fontes: lista(campos["fontes"]), itens }, erros };
}

/** Lê todos os temas. `arquivos`: caminho (qualquer) → conteúdo. O README é ignorado. */
export function lerBaseAjuda(arquivos: Record<string, string>): {
  temas: TemaAjuda[];
  erros: ErroAjuda[];
} {
  const temas: TemaAjuda[] = [];
  const erros: ErroAjuda[] = [];
  for (const caminho of Object.keys(arquivos).sort()) {
    const nome = caminho.split("/").pop()!.replace(/\.md$/i, "");
    if (nome.toLowerCase() === "readme" || nome.startsWith("_")) continue;
    const r = lerTemaAjuda(nome, arquivos[caminho]);
    temas.push(r.tema);
    erros.push(...r.erros);
  }
  return { temas, erros };
}

/** Linha da tabela como a sincronização grava. */
export function linhaDoItem(item: ItemAjuda) {
  return {
    chave: item.chave,
    titulo: `${item.categoria} — ${item.pergunta}`,
    conteudo: `${item.pergunta}\n${item.resposta}`,
    tags: item.palavras,
    ordem: item.ordem,
    hash: item.hash,
    origem: "ajuda",
    ativo: true,
  };
}

/** O que gravar e o que desativar, dado o que já está no banco (só linhas de origem "ajuda"). */
export function planejarSincronizacao(
  itens: ItemAjuda[],
  noBanco: { chave: string; hash: string | null; ativo: boolean }[],
) {
  const atual = new Map(noBanco.map((r) => [r.chave, r]));
  const gravar = itens.filter((it) => {
    const r = atual.get(it.chave);
    return !r || r.hash !== it.hash || !r.ativo;
  });
  const chaves = new Set(itens.map((it) => it.chave));
  const desativar = noBanco.filter((r) => r.ativo && !chaves.has(r.chave)).map((r) => r.chave);
  return { gravar, desativar };
}

/** Caminho alterado no git coberto por alguma fonte do tema (prefixo). */
export function temaCobre(tema: Pick<TemaAjuda, "fontes">, caminho: string): boolean {
  return tema.fontes.some(
    (f) => caminho === f || caminho.startsWith(f.endsWith("/") ? f : f + "/"),
  );
}

/** Mensagem com cara de dúvida sobre o uso do app ("como…", "onde…", "não aparece…")
 * e não de pedido de ação. Decide se o servidor injeta trechos da ajuda no contexto. */
export function pareceDuvidaDeUso(mensagem: string): boolean {
  const t = mensagem.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (t.includes("?")) return true;
  return /\b(como|onde|cade|qual (botao|tela|menu|aba|opcao)|nao (consigo|aparece|acho|encontro|funciona|esta funcionando)|tem como|da (pra|para)|para que serve|pra que serve|o que (e|significa)|por que|porque)\b/.test(
    t,
  );
}
