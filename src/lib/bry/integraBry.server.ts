// Integra Bry — camada de middleware da BRy que conecta a aplicação a
// certificados hospedados por OUTROS PSCs (Prestadores de Serviço de
// Confiança): BirdID/Soluti, Vidaas/Valid, SafeID/Safeweb, RemoteID/
// Certisign, SerproID, Syn/Syngular, DS Cloud/Digital Sign.
//
// Não confundir com BryKmsApi (src/lib/bry/kms.server.ts): aquele fala com
// o BRy KMS (certificado hospedado na PRÓPRIA BRy, provider=bry_cloud).
// Este fala com integra(.hom).bry.com.br para linkar/usar um certificado
// que o médico já tem em outra certificadora.
//
// Fonte: https://bry-developer.readme.io/reference/integra-bry. A assinatura
// usa o contrato HUB Signer com `kms_type: PSC` e `kms_data` contendo a URL
// do Integra Bry e o token retornado por /psc/link.
//
// Autenticação da aplicação: usa o mesmo access_token OAuth2 (client
// credentials) do restante da API BRy — ver authToken.server.ts. Esse
// token expira em minutos e é renovado automaticamente; não confundir com
// o X-API-KEY, que identifica o certificado linkado de um PSC específico.
import process from "node:process";
import { BryError } from "./bry.server";
import { getBryAccessToken } from "./authToken.server";

function isProductionEnvironment(value: string): boolean {
  return ["prod", "production", "producao", "produção"].includes(value.trim().toLowerCase());
}

async function getConfig() {
  // Mesma variável usada pelo endpoint de token (authToken.server.ts) —
  // eram duas antes (INTEGRA_BRY_ENV separado), o que permitia configurar
  // o token num ambiente e a URL base do Integra Bry em outro por engano.
  const env = process.env.BRY_ENV || "hom";
  const baseUrl =
    process.env.INTEGRA_BRY_BASE_URL ||
    (isProductionEnvironment(env)
      ? "https://integra.bry.com.br/api/service"
      : "https://integra.hom.bry.com.br/api/service");
  // Token OAuth2 renovado automaticamente (ver authToken.server.ts) — o
  // mesmo access_token da plataforma Bry Cloud usado pelo HUB Signer.
  // Fallback para BRY_HUB_TOKEN/BRY_API_TOKEN estático só pra quem ainda
  // não migrou para BRY_CLIENT_ID/BRY_CLIENT_SECRET.
  let token: string;
  try {
    token = await getBryAccessToken();
  } catch (err) {
    const fallback = process.env.BRY_HUB_TOKEN || process.env.BRY_API_TOKEN;
    if (!fallback) throw err;
    token = fallback;
  }
  // A assinatura em si não acontece no Integra Bry: o HUB Signer recebe o
  // PDF com `kms_type: PSC` e é ele quem chama o Integra Bry em
  // `kms_data.url` com o token do vínculo.
  const hubUrl =
    process.env.BRY_HUB_BASE_URL ||
    (isProductionEnvironment(env) ? "https://hub2.bry.com.br" : "https://hub2.hom.bry.com.br");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    hubUrl: hubUrl.replace(/\/+$/, ""),
    token,
  };
}

/** Lê uma data de expiração em qualquer um dos formatos usuais (ISO, epoch s/ms, segundos restantes). */
function parseExpiry(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const absolute = r.expiresAt ?? r.expires_at ?? r.expiration ?? r.expirationDate ?? r.exp;
  if (typeof absolute === "string" && absolute) {
    const t = Date.parse(absolute);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  if (typeof absolute === "number" && absolute > 0) {
    return new Date(absolute < 1e12 ? absolute * 1000 : absolute).toISOString();
  }
  const relative = r.expiresIn ?? r.expires_in ?? r.lifetime;
  if (typeof relative === "number" && relative > 0) {
    return new Date(Date.now() + relative * 1000).toISOString();
  }
  return null;
}

async function integraFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; apiKey?: string } = { method: "GET" },
): Promise<T> {
  const { baseUrl, token } = await getConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.apiKey) headers["X-API-KEY"] = init.apiKey;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new BryError("Não foi possível contatar o Integra Bry.", 502, String(e));
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep null */
  }

  if (!res.ok) {
    const message =
      (json as { message?: string } | null)?.message ?? `Integra Bry retornou ${res.status}.`;
    throw new BryError(
      message,
      res.status >= 400 && res.status < 500 ? res.status : 502,
      json ?? text,
    );
  }
  return json as T;
}

export interface PscInfo {
  /** Nome usado como `pscName` em /psc/link (ex.: "BirdID", "Vidaas"). */
  name: string;
  /** Nome comercial do provedor (ex.: "Soluti", "Valid"). */
  provider: string;
}

export type IntegraBryScope = "single_signature" | "multi_signature" | "signature_session";

export interface PscLinkRequest {
  pscName: string;
  redirectUri: string;
  state: string;
  numberOfDocuments?: number;
  /** Recomendado: "single_signature" para o caso de uso de 1 assinatura por vez. */
  scope?: IntegraBryScope;
  /** Segundos (180 a 604800). Equivalente ao "tempo de vida da requisição" de outras certificadoras. */
  lifetime?: number;
  cpf?: string;
  cnpj?: string;
}

export interface PscLinkResult {
  /** Link para o usuário abrir e autenticar no PSC escolhido. */
  authorizationUrl: string;
  /**
   * Credencial (X-API-KEY) a ser usada em /auth/info, /auth/certificate e na
   * assinatura. A resposta atual do Integra Bry usa o campo `token`.
   */
  apiKey: string;
  raw: unknown;
}

export interface PscCredentialInfo {
  status: string | null;
  pscName: string | null;
  /** Fim da autorização concedida no PSC, quando o Integra Bry informa. */
  expiresAt: string | null;
  raw: unknown;
}

export interface PscCertificateInfo {
  subject: string | null;
  holderDocument: string | null;
  issuer: string | null;
  validFrom: string | null;
  validUntil: string | null;
  raw: unknown;
}

export const IntegraBryApi = {
  /** GET /api/service/psc/list — lista de PSCs disponíveis para o link. */
  async listPscs(): Promise<PscInfo[]> {
    const resp = await integraFetch<
      Array<{ name?: string; provider?: string }> | { data?: unknown }
    >("/psc/list", { method: "GET" });
    const arr = Array.isArray(resp) ? resp : [];
    return arr.map((p) => ({ name: p.name ?? "", provider: p.provider ?? "" }));
  },

  /** POST /api/service/psc/link — gera o link de autenticação com o PSC escolhido. */
  async createLink(input: PscLinkRequest): Promise<PscLinkResult> {
    const resp = await integraFetch<{
      token?: string;
      authorizationUrl?: string;
      authorization_url?: string;
      url?: string;
      apiKey?: string;
      api_key?: string;
      credential?: string;
    }>("/psc/link", { method: "POST", body: input });
    const authorizationUrl = resp.authorizationUrl ?? resp.authorization_url ?? resp.url ?? "";
    if (!authorizationUrl) {
      throw new BryError("Integra Bry não retornou link de autenticação.", 502, resp);
    }
    const apiKey = resp.token ?? resp.apiKey ?? resp.api_key ?? resp.credential ?? "";
    if (!apiKey) {
      throw new BryError("Integra Bry não retornou a credencial do vínculo.", 502);
    }
    return {
      authorizationUrl,
      apiKey,
      raw: resp,
    };
  },

  /** GET /api/service/auth/info — status da credencial de autenticação gerada pelo link. */
  async getAuthInfo(apiKey: string): Promise<PscCredentialInfo> {
    const resp = await integraFetch<{ status?: string; pscName?: string; psc_name?: string }>(
      "/auth/info",
      { method: "GET", apiKey },
    );
    return {
      status: resp.status ?? null,
      pscName: resp.pscName ?? resp.psc_name ?? null,
      expiresAt: parseExpiry(resp),
      raw: resp,
    };
  },

  /** GET /api/service/auth/certificate — dados do certificado escolhido pelo usuário no PSC. */
  async getAuthCertificate(apiKey: string): Promise<PscCertificateInfo> {
    const resp = await integraFetch<{
      subject?: string;
      subjectName?: string;
      holderDocument?: string;
      cpf?: string;
      issuer?: string;
      validFrom?: string;
      notBefore?: string;
      validUntil?: string;
      notAfter?: string;
    }>("/auth/certificate", { method: "GET", apiKey });
    return {
      subject: resp.subject ?? resp.subjectName ?? null,
      holderDocument: resp.holderDocument ?? resp.cpf ?? null,
      issuer: resp.issuer ?? null,
      validFrom: resp.validFrom ?? resp.notBefore ?? null,
      validUntil: resp.validUntil ?? resp.notAfter ?? null,
      raw: resp,
    };
  },

  /** Assina um PDF com o certificado externo já autorizado pelo PSC. */
  async signPdf(input: {
    apiKey: string;
    pdfBuffer: Uint8Array;
    filename: string;
    reason?: string;
  }): Promise<{ signedPdf: Uint8Array; signatureTimestamp: string | null }> {
    const { baseUrl, hubUrl, token } = await getConfig();
    const dadosAssinatura = {
      kms_data: {
        url: baseUrl,
        token: input.apiKey,
      },
      perfil: "ADRB",
      algoritmoHash: "SHA256",
      tipoRetorno: "BASE64",
      ...(input.reason ? { razao: input.reason } : {}),
    };
    const form = new FormData();
    form.append(
      "documento[0]",
      new Blob([input.pdfBuffer as unknown as BlobPart], { type: "application/pdf" }),
      input.filename,
    );
    form.append("dados_assinatura", JSON.stringify(dadosAssinatura));

    let res: Response;
    try {
      res = await fetch(`${hubUrl}/fw/v1/pdf/kms/lote/assinaturas`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          kms_type: "PSC",
          Accept: "application/json",
        },
        body: form,
      });
    } catch (e) {
      throw new BryError(
        "Não foi possível contatar o HUB Signer da BRy para assinar.",
        502,
        String(e),
      );
    }

    const text = await res.text();
    if (!res.ok) {
      console.error("[bry:integra] sign_error", res.status, text.slice(0, 600));
      let providerMessage = "";
      try {
        const errorPayload = JSON.parse(text) as {
          message?: string;
          error_description?: string;
          error?: string;
        };
        providerMessage =
          errorPayload.message ?? errorPayload.error_description ?? errorPayload.error ?? "";
      } catch {
        providerMessage = text.slice(0, 300);
      }
      throw new BryError(
        providerMessage || `Integra Bry retornou ${res.status} ao assinar.`,
        res.status >= 400 && res.status < 500 ? res.status : 502,
        text.slice(0, 600),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const first = Array.isArray(parsed)
      ? parsed[0]
      : (parsed as { documentos?: Array<{ documento?: string }> } | null)?.documentos?.[0]
          ?.documento;
    const b64 =
      typeof first === "string" ? first : (first as { documento?: string } | undefined)?.documento;
    if (!b64) {
      throw new BryError(
        "Integra Bry não retornou o documento assinado no formato esperado — " +
          "confirmar contrato do endpoint antes de usar em produção.",
        502,
        text.slice(0, 300),
      );
    }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { signedPdf: bytes, signatureTimestamp: new Date().toISOString() };
  },
};
