// Obtém e mantém em cache o access_token JWT da BRy Cloud (OAuth2 client
// credentials). Usado por qualquer chamada à BRy que precise de
// Authorization: Bearer — tanto o BRyKMS (kms.server.ts, provider bry_cloud)
// quanto o Integra Bry (integraBry.server.ts, provider "externo").
//
// Importante: o access_token da BRy expira em POUCOS MINUTOS ("validade de
// alguns minutos", conforme bry-developer.readme.io/reference/autentication-doc).
// Ele NÃO é uma credencial estática que se configura uma vez — precisa ser
// renovado automaticamente. As credenciais realmente estáveis são
// `client_id`/`client_secret`, obtidas uma única vez no portal Bry Cloud
// (cloud.bry.com.br ou cloud-hom.bry.com.br, menu Gestão > Minhas aplicações
// > emitir client_secret).
//
// Endpoint confirmado (bry-developer.readme.io/reference/post_token-service-jwt):
//   Homologação: POST https://cloud-hom.bry.com.br/token-service/jwt
//   Produção:    POST https://cloud.bry.com.br/token-service/jwt
//   Content-Type: application/x-www-form-urlencoded
//   Body: grant_type=client_credentials&client_id=...&client_secret=...
//   Resposta: { access_token, expires_in, refresh_token, refresh_expires_in, ... }
import process from "node:process";
import { BryError } from "./bry.server";

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
// Renova um pouco antes do vencimento real, pra não correr risco de usar um
// token que expira no meio de uma chamada em andamento.
const SAFETY_MARGIN_MS = 20_000;

function getAuthBaseUrl(): string {
  const explicit = process.env.BRY_AUTH_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const env = (process.env.BRY_ENV || "hom").toLowerCase();
  return env === "prod" ? "https://cloud.bry.com.br" : "https://cloud-hom.bry.com.br";
}

async function fetchNewToken(): Promise<CachedToken> {
  const clientId = process.env.BRY_CLIENT_ID;
  const clientSecret = process.env.BRY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new BryError(
      "Integração BRy não configurada (BRY_CLIENT_ID/BRY_CLIENT_SECRET ausentes). " +
        "Essas credenciais são obtidas no portal Bry Cloud, menu Gestão > Minhas aplicações.",
      503,
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  let res: Response;
  try {
    res = await fetch(`${getAuthBaseUrl()}/token-service/jwt`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (e) {
    throw new BryError(
      "Não foi possível contatar o serviço de autenticação da BRy.",
      502,
      String(e),
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new BryError(
      `Falha ao obter token de acesso da BRy (${res.status}). Verifique BRY_CLIENT_ID/BRY_CLIENT_SECRET.`,
      res.status >= 400 && res.status < 500 ? res.status : 502,
      text.slice(0, 300),
    );
  }

  let json: { access_token?: string; expires_in?: number } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep null */
  }
  if (!json?.access_token) {
    throw new BryError(
      "Resposta do serviço de token da BRy não trouxe access_token.",
      502,
      text.slice(0, 300),
    );
  }

  const expiresInSeconds = typeof json.expires_in === "number" ? json.expires_in : 60;
  return { token: json.access_token, expiresAt: Date.now() + expiresInSeconds * 1000 };
}

/** Devolve um access_token válido, renovando automaticamente quando necessário. */
export async function getBryAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return cached.token;
  }
  cached = await fetchNewToken();
  return cached.token;
}
