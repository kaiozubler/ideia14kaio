// Busca no PubMed pelas E-utilities do NCBI (esearch → efetch).
// Sem chave o NCBI aceita 3 req/s por IP; com NCBI_API_KEY, 10 req/s.
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export type ArtigoPubmed = {
  pmid: string;
  titulo: string;
  descricao: string;
  revista: string;
  ano: string;
  autores: string;
  url: string;
  /** Link do DOI (editora) e do espelho Europe PMC: alternativas quando a
   * verificação anti-robô do PubMed bloqueia o navegador do médico. */
  doi: string | null;
  europepmc: string;
};

function params(extra: Record<string, string>) {
  const p = new URLSearchParams({ tool: "medicopilot", ...extra });
  if (process.env.NCBI_API_KEY) p.set("api_key", process.env.NCBI_API_KEY);
  return p;
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function textoXml(s: string | undefined): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTIDADES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const primeiro = (xml: string, re: RegExp) => re.exec(xml)?.[1];

function artigoDoXml(xml: string): ArtigoPubmed | null {
  const pmid = textoXml(primeiro(xml, /<PMID[^>]*>([\s\S]*?)<\/PMID>/));
  if (!pmid) return null;
  const titulo = textoXml(primeiro(xml, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/));
  const resumo = Array.from(xml.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g))
    .map((m) => {
      const rotulo = /Label="([^"]+)"/.exec(m[1])?.[1];
      const txt = textoXml(m[2]);
      return rotulo ? `${rotulo[0]}${rotulo.slice(1).toLowerCase()}: ${txt}` : txt;
    })
    .join(" ");
  const revista = textoXml(primeiro(xml, /<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/));
  const ano =
    textoXml(primeiro(xml, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)) ||
    textoXml(primeiro(xml, /<MedlineDate>(\d{4})/));
  const nomes = Array.from(xml.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g))
    .map((m) => {
      const sobrenome = textoXml(primeiro(m[1], /<LastName>([\s\S]*?)<\/LastName>/));
      const iniciais = textoXml(primeiro(m[1], /<Initials>([\s\S]*?)<\/Initials>/));
      return sobrenome
        ? `${sobrenome} ${iniciais}`.trim()
        : textoXml(primeiro(m[1], /<CollectiveName>([\s\S]*?)<\/CollectiveName>/));
    })
    .filter(Boolean);
  // O DOI do próprio artigo: ELocationID ou o ArticleIdList que vem antes da
  // lista de referências (que traz os DOIs dos artigos citados).
  const doi =
    textoXml(primeiro(xml, /<ELocationID[^>]*EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/)) ||
    textoXml(
      primeiro(xml.split(/<ReferenceList/)[0], /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/),
    );
  const autores = nomes.length > 3 ? `${nomes.slice(0, 3).join(", ")} et al.` : nomes.join(", ");
  return {
    pmid,
    titulo: titulo || "(sem título)",
    descricao: resumo.slice(0, 900) || "Resumo não disponível no PubMed.",
    revista,
    ano,
    autores,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    doi: doi ? `https://doi.org/${doi}` : null,
    europepmc: `https://europepmc.org/article/MED/${pmid}`,
  };
}

export async function comTempo(url: string, ms: number, init?: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function buscarPubmed(
  consulta: string,
  limite = 8,
): Promise<{ total: number; artigos: ArtigoPubmed[] }> {
  const busca = await comTempo(
    `${EUTILS}/esearch.fcgi?${params({ db: "pubmed", term: consulta, retmode: "json", retmax: String(limite), sort: "relevance" })}`,
    10_000,
  );
  if (!busca.ok) throw new Error(`PubMed esearch ${busca.status}`);
  const dados = (await busca.json()) as { esearchresult?: { count?: string; idlist?: string[] } };
  const ids = dados.esearchresult?.idlist ?? [];
  const total = Number(dados.esearchresult?.count ?? 0) || 0;
  if (!ids.length) return { total, artigos: [] };

  const det = await comTempo(
    `${EUTILS}/efetch.fcgi?${params({ db: "pubmed", id: ids.join(","), retmode: "xml" })}`,
    12_000,
  );
  if (!det.ok) throw new Error(`PubMed efetch ${det.status}`);
  const xml = await det.text();
  const porId = new Map<string, ArtigoPubmed>();
  for (const bloco of xml.split(/<PubmedArticle>/).slice(1)) {
    const a = artigoDoXml(bloco);
    if (a) porId.set(a.pmid, a);
  }
  // efetch não garante a ordem do esearch (relevância).
  return { total, artigos: ids.map((id) => porId.get(id)).filter((a): a is ArtigoPubmed => !!a) };
}
