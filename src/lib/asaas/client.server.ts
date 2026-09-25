// Cliente mínimo pra API do Asaas (https://docs.asaas.com/reference).
// Só usado em rotas de servidor — a chave nunca deve chegar ao navegador.
//
// Variáveis de ambiente necessárias (ainda não configuradas neste projeto —
// ver o aviso que a rota /api/asaas/checkout devolve quando faltam):
//   ASAAS_API_KEY — chave de API (começa com $aact_hmlg_ no Sandbox, $aact_prod_ em produção)
//   ASAAS_ENV     — "production" para usar a API real; qualquer outro valor (ou ausente) usa Sandbox
//
// Comece pelo Sandbox (https://docs.asaas.com/docs/sandbox): crie uma conta
// de teste, gere uma chave de lá, e só troque pra produção depois de testar
// o fluxo de ponta a ponta.

const BASE_URL_SANDBOX = "https://api-sandbox.asaas.com/v3";
const BASE_URL_PRODUCAO = "https://api.asaas.com/v3";

export function ambienteAsaas(): "sandbox" | "production" {
  return process.env["ASAAS_ENV"] === "production" ? "production" : "sandbox";
}

function baseUrl(): string {
  return ambienteAsaas() === "production" ? BASE_URL_PRODUCAO : BASE_URL_SANDBOX;
}

export class AsaasNaoConfiguradoError extends Error {
  constructor() {
    super("ASAAS_API_KEY não configurada no servidor");
    this.name = "AsaasNaoConfiguradoError";
  }
}

export class AsaasApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AsaasApiError";
  }
}

type AsaasErrorBody = { errors?: { code?: string; description?: string }[] };

export async function asaasFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env["ASAAS_API_KEY"];
  if (!apiKey) throw new AsaasNaoConfiguradoError();

  const resp = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "MediCopilot",
      access_token: apiKey,
      ...(init?.headers ?? {}),
    },
  });

  const texto = await resp.text();
  const corpo = texto ? (JSON.parse(texto) as unknown) : null;

  if (!resp.ok) {
    const descricao = (corpo as AsaasErrorBody | null)?.errors?.[0]?.description ?? `Asaas respondeu ${resp.status}`;
    throw new AsaasApiError(descricao, resp.status);
  }

  return corpo as T;
}
