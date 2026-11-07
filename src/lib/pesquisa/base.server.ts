// Pesquisa da tela "Base de conhecimento" (campo de busca no topo).
//
// Lê com o cliente do próprio usuário (token verificado repassado ao RLS),
// nunca com supabaseAdmin: a busca só pode enxergar as bases que o médico
// já enxerga na tela.
//
// A busca do chat (buscar_base_conhecimento) usa similaridade de trigramas do
// trecho inteiro contra a mensagem — boa para mensagens longas, ruim para uma
// consulta curta de 1 a 3 palavras, que quase nunca passa do limiar contra um
// trecho de ~1600 caracteres. Aqui cada termo vira um ILIKE e o ranking é
// feito em JS pela quantidade de termos encontrados.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ResultadoBase = {
  base_id: string;
  base_nome: string;
  titulo: string;
  descricao: string;
  tipo: "arquivo" | "texto" | "base";
  pontos: number;
};

const STOPWORDS = new Set(
  "a o as os de da do das dos e em no na nos nas um uma uns umas para por com sem que qual quais como ao aos se ou mais menos sobre entre pelo pela pelos pelas é ser são".split(
    " ",
  ),
);

export function termosDaConsulta(q: string): string[] {
  const termos = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(termos)).slice(0, 8);
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Trecho de até ~320 caracteres em volta do primeiro termo encontrado. */
function recorte(texto: string, termos: string[]): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const base = semAcento(limpo);
  let pos = -1;
  for (const t of termos) {
    const p = base.indexOf(semAcento(t));
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0 || pos < 120) return limpo.slice(0, 320);
  const ini = limpo.lastIndexOf(" ", pos - 100);
  return "…" + limpo.slice(ini < 0 ? pos - 100 : ini + 1, (ini < 0 ? pos - 100 : ini + 1) + 320);
}

function contarTermos(texto: string, termos: string[]): number {
  const base = semAcento(texto);
  let n = 0;
  for (const t of termos) {
    const alvo = semAcento(t);
    let i = base.indexOf(alvo);
    let ocorr = 0;
    while (i >= 0 && ocorr < 5) {
      ocorr++;
      i = base.indexOf(alvo, i + alvo.length);
    }
    // Ter o termo vale mais do que repeti-lo.
    if (ocorr) n += 10 + ocorr;
  }
  return n;
}

// PostgREST usa vírgula, parênteses e % na sintaxe do filtro `or`. Vogais e
// c/ç viram o curinga `_` para o ILIKE não depender de acento ("cronica"
// acha "crônica"); o que sobra de falso positivo sai no ranking em JS, que
// compara sem acento e descarta quem não tem nenhum termo.
const paraIlike = (t: string) =>
  t
    .replace(/[,()%_\\*.:"']/g, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[aeiouc]/gi, "_");

export function clienteDoToken(token: string): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Busca nas bases do usuário dono do `client`. Um arquivo ou texto enviado
 * vira vários trechos no banco; o resultado volta agrupado por envio (mesma
 * regra de agrupamento da tela), com o melhor trecho como descrição.
 */
export async function pesquisarBase(
  client: SupabaseClient,
  q: string,
  limite = 8,
): Promise<ResultadoBase[]> {
  const termos = termosDaConsulta(q);
  if (!termos.length) return [];
  const filtro = termos.map((t) => `conteudo.ilike.%${paraIlike(t)}%`).join(",");

  const [itensRes, basesRes] = await Promise.all([
    client
      .from("base_conhecimento_itens")
      .select(
        "id, base_id, tipo, nome_original, conteudo, created_at, base_conhecimento!inner(nome, ativo)",
      )
      .or(filtro)
      .limit(120),
    client.from("base_conhecimento").select("id, nome, descricao, tags, ativo"),
  ]);
  if (itensRes.error) throw new Error(itensRes.error.message);
  if (basesRes.error) throw new Error(basesRes.error.message);

  type Item = {
    id: string;
    base_id: string;
    tipo: "arquivo" | "texto";
    nome_original: string | null;
    conteudo: string;
    created_at: string;
    base_conhecimento: { nome: string } | { nome: string }[] | null;
  };
  const grupos = new Map<string, ResultadoBase>();
  for (const it of (itensRes.data ?? []) as Item[]) {
    const b = Array.isArray(it.base_conhecimento) ? it.base_conhecimento[0] : it.base_conhecimento;
    const baseNome = b?.nome ?? "Base";
    const pontos =
      contarTermos(it.conteudo, termos) + contarTermos(it.nome_original ?? "", termos) * 2;
    if (pontos <= 0) continue;
    const chave = [it.base_id, it.tipo, it.nome_original ?? "", it.created_at].join("|");
    const atual = grupos.get(chave);
    if (!atual || pontos > atual.pontos) {
      grupos.set(chave, {
        base_id: it.base_id,
        base_nome: baseNome,
        titulo: it.nome_original || baseNome,
        descricao: recorte(it.conteudo, termos),
        tipo: it.tipo,
        pontos,
      });
    }
  }

  // A própria base também é resultado quando o nome, a descrição ou as tags batem.
  for (const b of (basesRes.data ?? []) as {
    id: string;
    nome: string;
    descricao: string | null;
    tags: string[] | null;
  }[]) {
    const pontos =
      contarTermos(`${b.nome} ${(b.tags ?? []).join(" ")}`, termos) * 2 +
      contarTermos(b.descricao ?? "", termos);
    if (pontos > 0) {
      grupos.set(`base|${b.id}`, {
        base_id: b.id,
        base_nome: b.nome,
        titulo: b.nome,
        descricao: b.descricao || "Base de conhecimento",
        tipo: "base",
        pontos: pontos + 5,
      });
    }
  }

  return Array.from(grupos.values())
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite);
}
