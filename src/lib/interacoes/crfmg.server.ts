/**
 * Cliente HTTP para a API de Interações Medicamentosas do CRF-MG.
 * Uso exclusivo no servidor (sincronização periódica).
 * NUNCA deve ser chamado durante a prescrição.
 */

export type CrfmgMedicamento = {
  id: number;
  nome: string;
  indicacoes?: string | null;
};

export type CrfmgInteracao = {
  id: number;
  medicamento1: CrfmgMedicamento;
  medicamento2: CrfmgMedicamento;
  acao?: string | null;
  mecanismo_efeito?: string | null;
  recomendacoes?: string | null;
};

export class RateLimitPersistenteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitPersistenteError";
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CrfmgConfig = {
  baseUrl: string;
  apiKey: string;
  /** intervalo entre chamadas (ms) */
  delayMs: number;
  /** tentativas por requisição */
  maxRetries: number;
  /** timeout de cada requisição (ms) */
  timeoutMs: number;
};

export function getCrfmgConfig(overrides: Partial<CrfmgConfig> = {}): CrfmgConfig {
  const apiKey = process.env.CRFMG_API_KEY;
  if (!apiKey) throw new Error("CRFMG_API_KEY não configurada");
  const baseUrl = (process.env.CRFMG_BASE_URL || "https://imses.crfmg.org.br/api").replace(/\/+$/, "");
  return {
    baseUrl,
    apiKey,
    delayMs: Number(process.env.CRFMG_DELAY_MS ?? 500),
    maxRetries: 4,
    timeoutMs: 20000,
    ...overrides,
  };
}

/** Requisição resiliente: retry com backoff exponencial + jitter. */
export async function crfmgFetch<T>(
  cfg: CrfmgConfig,
  path: string,
  opts: { allow404?: boolean } = {},
): Promise<T | null> {
  let rateLimitStreak = 0;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}${path}`, {
        headers: { "X-API-Key": cfg.apiKey, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return (await res.json()) as T;

      // 400/404 = medicamento sem interação conhecida — não é erro de rede
      if (res.status === 400 || (res.status === 404 && opts.allow404 !== false)) return null;

      if (res.status === 401 || res.status === 403) {
        throw new Error(`CRF-MG: credencial inválida (${res.status})`);
      }

      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new Error(`CRF-MG ${path} falhou [${res.status}]: ${(await res.text()).slice(0, 300)}`);
      }

      if (res.status === 429) rateLimitStreak++;
      if (rateLimitStreak >= 3) {
        throw new RateLimitPersistenteError("Rate limit persistente na API do CRF-MG");
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof RateLimitPersistenteError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof Error && (err.name === "AbortError" || /timeout|network|fetch/i.test(msg));
      if (!isTimeout || attempt === cfg.maxRetries) {
        if (attempt === cfg.maxRetries) throw new Error(msg);
        if (!isTimeout) throw err;
      }
    }

    if (attempt === cfg.maxRetries) break;
    // backoff exponencial com jitter: 1s, 2s, 4s, 8s (+/- 250ms)
    const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
    await sleep(backoff);
  }

  throw new Error(`CRF-MG ${path}: falha após ${cfg.maxRetries + 1} tentativas`);
}

/** Catálogo completo (1 única requisição). */
export async function listarMedicamentos(cfg: CrfmgConfig): Promise<CrfmgMedicamento[]> {
  const data = await crfmgFetch<{ medicamentos: (CrfmgMedicamento & { interacoes?: unknown })[] }>(
    cfg,
    "/medicamentos",
    { allow404: false },
  );
  return (data?.medicamentos ?? []).map((m) => ({
    id: m.id,
    nome: m.nome,
    indicacoes: m.indicacoes ?? null,
  }));
}

/** Interações de um medicamento específico. Retorna [] quando não há interação conhecida. */
export async function buscarInteracoesDoMedicamento(
  cfg: CrfmgConfig,
  nome: string,
): Promise<CrfmgInteracao[]> {
  const data = await crfmgFetch<{ medicamento?: CrfmgMedicamento; interacoes?: CrfmgInteracao[] }>(
    cfg,
    `/medicamento/${encodeURIComponent(nome)}`,
  );
  return data?.interacoes ?? [];
}