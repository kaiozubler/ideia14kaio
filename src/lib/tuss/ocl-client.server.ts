/**
 * Cliente genérico para a API pública OCL da ANS.
 * Reutilizável para qualquer tabela TUSS (tuss-22, tuss-18, tuss-19, tuss-20, ...)
 * bastando alterar o slug da tabela de origem.
 */

export type OclConcept = {
  id: string;
  source?: string | null;
  display_name?: string | null;
  extras?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type OclConfig = {
  baseUrl: string;
  /** slug da tabela de origem na ANS, ex.: "tuss-22" */
  tabela: string;
  maxRetries: number;
  timeoutMs: number;
};

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getOclConfig(overrides: Partial<OclConfig> = {}): OclConfig {
  const baseUrl = (
    process.env.ANS_OCL_BASE_URL ||
    "https://consulta-ocl.apps.sa-1a.mendixcloud.com/rest/oclservice/ANS/concepts"
  ).replace(/\/+$/, "");
  return { baseUrl, tabela: "tuss-22", maxRetries: 4, timeoutMs: 25000, ...overrides };
}

export type OclPage = { itens: OclConcept[]; totalPaginas: number | null };

/** Busca uma página com retry/backoff. Retorna também o total de páginas (header `pages`). */
export async function buscarPagina(cfg: OclConfig, page: number): Promise<OclPage> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}/${cfg.tabela}?page=${page}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const totalHeader = res.headers.get("pages");
        const body = (await res.json()) as unknown;
        const itens = Array.isArray(body)
          ? (body as OclConcept[])
          : ((body as { items?: OclConcept[] })?.items ?? []);
        return {
          itens,
          totalPaginas: totalHeader && /^\d+$/.test(totalHeader) ? Number(totalHeader) : null,
        };
      }

      if (res.status === 404) return { itens: [], totalPaginas: null };
      if (!RETRYABLE.has(res.status)) {
        throw new Error(`ANS OCL ${cfg.tabela} p.${page} falhou [${res.status}]`);
      }
      lastErr = new Error(`ANS OCL ${cfg.tabela} p.${page} [${res.status}]`);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }

    if (attempt === cfg.maxRetries) break;
    await sleep(800 * 2 ** attempt + Math.floor(Math.random() * 250));
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`ANS OCL ${cfg.tabela} p.${page}: falha após ${cfg.maxRetries + 1} tentativas`);
}

/** Descobre o total de páginas disponível no momento (sem número fixo). */
export async function descobrirTotalPaginas(cfg: OclConfig): Promise<number> {
  const { totalPaginas, itens } = await buscarPagina(cfg, 1);
  if (totalPaginas && totalPaginas > 0) return totalPaginas;
  // fallback: varre até encontrar página vazia
  if (!itens.length) return 0;
  let page = 1;
  for (;;) {
    page++;
    const p = await buscarPagina(cfg, page);
    if (!p.itens.length) return page - 1;
    if (page > 5000) return page;
  }
}
