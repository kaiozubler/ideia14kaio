// Fontes externas da pesquisa da Base de conhecimento. Cada uma devolve o
// mesmo formato (ResultadoExterno), então a tela desenha qualquer fonte nova
// sem código próprio. Só entram fontes com API pública e conteúdo de
// relevância acadêmica ou profissional para a medicina no Brasil.
import { buscarPubmed, comTempo, textoXml, type ArtigoPubmed } from "./pubmed.server";
import { consultaEmIngles } from "./ingles.server";

export type ResultadoExterno = {
  id: string;
  /** Identificador exibido à direita da linha de origem (ex.: "PMID 123"). */
  codigo: string;
  titulo: string;
  descricao: string;
  /** Revista · ano, ou fase · patrocinador. */
  origem: string;
  autores: string;
  url: string;
  links: { rotulo: string; url: string }[];
  selos: string[];
};

export type RespostaFonte = {
  /** Consulta efetivamente enviada (em inglês nas fontes que exigem). */
  consulta: string;
  total: number;
  resultados: ResultadoExterno[];
  /** Página da própria fonte com todos os resultados. */
  ver_todos: string | null;
};

export const FONTES_EXTERNAS = [
  "pubmed",
  "cochrane",
  "europepmc",
  "scielo",
  "clinicaltrials",
] as const;
export type FonteExterna = (typeof FONTES_EXTERNAS)[number];

const LIMITE = 8;
const HEADERS = { "User-Agent": "MediCopilot/1.0 (pesquisa clínica)" };

async function json<T>(url: string): Promise<T> {
  const res = await comTempo(url, 12_000, { headers: HEADERS });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

/** Busca em inglês e, sem resultado, de novo com o texto original. */
async function comConsultaEmIngles(
  q: string,
  buscar: (consulta: string) => Promise<Omit<RespostaFonte, "consulta">>,
): Promise<RespostaFonte> {
  const ingles = await consultaEmIngles(q);
  let consulta = ingles || q;
  let r = await buscar(consulta);
  if (!r.resultados.length && ingles && ingles !== q) {
    consulta = q;
    r = await buscar(q);
  }
  return { consulta, ...r };
}

/* ---------- PubMed e Cochrane (Cochrane = PubMed filtrado pela revista) ---------- */
function doPubmed(a: ArtigoPubmed): ResultadoExterno {
  return {
    id: a.pmid,
    codigo: `PMID ${a.pmid}`,
    titulo: a.titulo,
    descricao: a.descricao,
    origem: [a.revista, a.ano].filter(Boolean).join(" · "),
    autores: a.autores,
    url: a.url,
    links: [
      { rotulo: "PubMed", url: a.url },
      ...(a.doi ? [{ rotulo: "Artigo (DOI)", url: a.doi }] : []),
      { rotulo: "Europe PMC", url: a.europepmc },
    ],
    selos: [],
  };
}

const COCHRANE = '"Cochrane Database Syst Rev"[ta]';

async function pubmed(q: string, cochrane = false): Promise<RespostaFonte> {
  return comConsultaEmIngles(q, async (consulta) => {
    const termo = cochrane ? `(${consulta}) AND ${COCHRANE}` : consulta;
    const r = await buscarPubmed(termo, LIMITE);
    return {
      total: r.total,
      resultados: r.artigos.map((a) => {
        const item = doPubmed(a);
        if (cochrane) {
          // O DOI das revisões Cochrane (10.1002/14651858) abre na Cochrane Library.
          item.selos = ["Revisão sistemática"];
          item.links = item.links.map((l) =>
            l.rotulo === "Artigo (DOI)" ? { ...l, rotulo: "Cochrane Library" } : l,
          );
        }
        return item;
      }),
      ver_todos: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(termo)}`,
    };
  });
}

/* ---------- Europe PMC: PubMed + preprints + texto completo aberto ---------- */
type EuropePmc = {
  hitCount?: number;
  resultList?: {
    result?: {
      id: string;
      source: string;
      pmid?: string;
      pmcid?: string;
      doi?: string;
      title?: string;
      authorString?: string;
      pubYear?: string;
      abstractText?: string;
      isOpenAccess?: string;
      journalInfo?: { journal?: { title?: string } };
      bookOrReportDetails?: { publisher?: string };
      pubTypeList?: { pubType?: string[] };
    }[];
  };
};

function autoresCurtos(s: string | undefined) {
  const nomes = (s ?? "").replace(/\.$/, "").split(/,\s*/).filter(Boolean);
  return nomes.length > 3 ? `${nomes.slice(0, 3).join(", ")} et al.` : nomes.join(", ");
}

async function europepmc(q: string): Promise<RespostaFonte> {
  return comConsultaEmIngles(q, async (consulta) => {
    const d = await json<EuropePmc>(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({
        query: consulta,
        format: "json",
        resultType: "core",
        pageSize: String(LIMITE),
      })}`,
    );
    const resultados = (d.resultList?.result ?? []).map((r): ResultadoExterno => {
      const url = `https://europepmc.org/article/${r.source}/${r.id}`;
      const preprint =
        r.source === "PPR" || (r.pubTypeList?.pubType ?? []).some((t) => /preprint/i.test(t));
      const selos = [
        ...(r.isOpenAccess === "Y" ? ["Texto completo aberto"] : []),
        ...(preprint ? ["Preprint (sem revisão por pares)"] : []),
      ];
      return {
        id: `${r.source}:${r.id}`,
        codigo: r.pmid ? `PMID ${r.pmid}` : r.pmcid || r.id,
        titulo: textoXml(r.title) || "(sem título)",
        descricao: textoXml(r.abstractText).slice(0, 900) || "Resumo não disponível.",
        origem: [r.journalInfo?.journal?.title || r.bookOrReportDetails?.publisher, r.pubYear]
          .filter(Boolean)
          .join(" · "),
        autores: autoresCurtos(r.authorString),
        url,
        links: [
          { rotulo: "Europe PMC", url },
          ...(r.pmid
            ? [{ rotulo: "PubMed", url: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` }]
            : []),
          ...(r.doi ? [{ rotulo: "Artigo (DOI)", url: `https://doi.org/${r.doi}` }] : []),
        ],
        selos,
      };
    });
    return {
      total: d.hitCount ?? resultados.length,
      resultados,
      ver_todos: `https://europepmc.org/search?query=${encodeURIComponent(consulta)}`,
    };
  });
}

/* ---------- SciELO Brasil ---------- */
// O buscador da SciELO bloqueia acesso automatizado; a API pública do Crossref
// tem os mesmos artigos (todo DOI da SciELO Brasil começa com 10.1590) e
// aceita a pesquisa em português, sem tradução.
type Crossref = {
  message?: {
    "total-results"?: number;
    items?: {
      DOI: string;
      title?: string[];
      abstract?: string;
      "container-title"?: string[];
      author?: { given?: string; family?: string; name?: string }[];
      issued?: { "date-parts"?: (number | null)[][] };
      URL?: string;
    }[];
  };
};

async function scielo(q: string): Promise<RespostaFonte> {
  const d = await json<Crossref>(
    `https://api.crossref.org/works?${new URLSearchParams({
      "query.bibliographic": q,
      // A relevância do Crossref favorece artigos antigos; a pesquisa clínica
      // precisa do que é atual.
      filter: "prefix:10.1590,type:journal-article,from-pub-date:2010",
      rows: String(LIMITE),
      select: "DOI,title,abstract,container-title,author,issued,URL",
    })}`,
  );
  const resultados = (d.message?.items ?? []).map((r): ResultadoExterno => {
    const nomes = (r.author ?? [])
      .map((a) =>
        a.family
          ? `${a.family} ${(a.given ?? "").replace(/[^A-ZÀ-Ý]/g, "")}`.trim()
          : (a.name ?? ""),
      )
      .filter(Boolean);
    const ano = r.issued?.["date-parts"]?.[0]?.[0];
    const doi = `https://doi.org/${r.DOI}`;
    // Resumos JATS costumam começar com o rótulo da seção ("RESUMO", "Abstract").
    const resumo = textoXml(r.abstract).replace(/^(resumo|abstract|resumen)\s*:?\s*/i, "");
    return {
      id: r.DOI,
      codigo: "",
      titulo: textoXml(r.title?.[0]) || "(sem título)",
      descricao: resumo.slice(0, 900) || "Resumo não disponível.",
      origem: [r["container-title"]?.[0], ano].filter(Boolean).join(" · "),
      autores: nomes.length > 3 ? `${nomes.slice(0, 3).join(", ")} et al.` : nomes.join(", "),
      url: doi,
      links: [
        { rotulo: "SciELO", url: doi },
        {
          rotulo: "Google Acadêmico",
          url: `https://scholar.google.com/scholar?q=${encodeURIComponent(r.DOI)}`,
        },
      ],
      selos: [],
    };
  });
  return {
    consulta: q,
    total: d.message?.["total-results"] ?? resultados.length,
    resultados,
    ver_todos: `https://search.scielo.org/?q=${encodeURIComponent(q)}&lang=pt`,
  };
}

/* ---------- ClinicalTrials.gov ---------- */
type CtGov = {
  totalCount?: number;
  studies?: {
    protocolSection?: {
      identificationModule?: { nctId?: string; briefTitle?: string };
      statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
      descriptionModule?: { briefSummary?: string };
      sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
      designModule?: { phases?: string[]; studyType?: string };
      contactsLocationsModule?: { locations?: { country?: string }[] };
    };
  }[];
};

const STATUS: Record<string, string> = {
  RECRUITING: "Recrutando",
  NOT_YET_RECRUITING: "Ainda não recrutando",
  ACTIVE_NOT_RECRUITING: "Em andamento, sem recrutar",
  ENROLLING_BY_INVITATION: "Recrutando por convite",
  COMPLETED: "Concluído",
  TERMINATED: "Encerrado antes do fim",
  WITHDRAWN: "Retirado",
  SUSPENDED: "Suspenso",
  UNKNOWN: "Status desconhecido",
};
const FASE: Record<string, string> = {
  EARLY_PHASE1: "Fase 1 inicial",
  PHASE1: "Fase 1",
  PHASE2: "Fase 2",
  PHASE3: "Fase 3",
  PHASE4: "Fase 4",
};

async function clinicaltrials(q: string): Promise<RespostaFonte> {
  return comConsultaEmIngles(q, async (consulta) => {
    const d = await json<CtGov>(
      `https://clinicaltrials.gov/api/v2/studies?${new URLSearchParams({
        "query.term": consulta,
        pageSize: String(LIMITE),
        countTotal: "true",
        fields:
          "NCTId,BriefTitle,OverallStatus,StartDate,BriefSummary,LeadSponsorName,Phase,StudyType,LocationCountry",
      })}`,
    );
    const resultados = (d.studies ?? []).map((s): ResultadoExterno => {
      const p = s.protocolSection ?? {};
      const nct = p.identificationModule?.nctId ?? "";
      const url = `https://clinicaltrials.gov/study/${nct}`;
      const fases = (p.designModule?.phases ?? [])
        .map((f) => FASE[f])
        .filter(Boolean)
        .join("/");
      const tipo =
        p.designModule?.studyType === "OBSERVATIONAL" ? "Observacional" : "Intervencional";
      const noBrasil = (p.contactsLocationsModule?.locations ?? []).some(
        (l) => l.country === "Brazil",
      );
      const status = p.statusModule?.overallStatus ?? "UNKNOWN";
      return {
        id: nct,
        codigo: nct,
        titulo: p.identificationModule?.briefTitle || nct,
        descricao:
          (p.descriptionModule?.briefSummary ?? "").replace(/\s+/g, " ").trim().slice(0, 900) ||
          "Resumo não disponível.",
        origem: [tipo, fases, p.sponsorCollaboratorsModule?.leadSponsor?.name]
          .filter(Boolean)
          .join(" · "),
        autores: "",
        url,
        links: [{ rotulo: "ClinicalTrials.gov", url }],
        selos: [STATUS[status] ?? status, ...(noBrasil ? ["Centro no Brasil"] : [])],
      };
    });
    return {
      total: d.totalCount ?? resultados.length,
      resultados,
      ver_todos: `https://clinicaltrials.gov/search?term=${encodeURIComponent(consulta)}`,
    };
  });
}

export function pesquisarFonte(fonte: FonteExterna, q: string): Promise<RespostaFonte> {
  switch (fonte) {
    case "pubmed":
      return pubmed(q);
    case "cochrane":
      return pubmed(q, true);
    case "europepmc":
      return europepmc(q);
    case "scielo":
      return scielo(q);
    case "clinicaltrials":
      return clinicaltrials(q);
  }
}
