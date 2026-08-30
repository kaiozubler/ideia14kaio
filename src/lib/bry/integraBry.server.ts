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
// Fonte: https://bry-developer.readme.io/reference/integra-bry (confirmado
// por fetch em 2026-08-24). Endpoints de listagem/link/info do certificado
// estão documentados publicamente; o endpoint FINAL de assinatura (depois
// de linkado) reaproveita o mesmo contrato do HUB Signer
// (fw/v1/pdf/kms/lote/assinaturas, ver kms.server.ts) trocando a URL base —
// mas o header exato de autenticação nesse passo final não está nas páginas
// públicas da doc (exemplos de request/response ficam atrás de login em
// bry-developer.readme.io). Ver signPdf() abaixo: a implementação está
// pronta mas sinalizada para confirmação antes de uso em produção.
//
// Autenticação da aplicação: usa o mesmo access_token OAuth2 (client
// credentials) do restante da API BRy — ver authToken.server.ts. Esse
// token expira em minutos e é renovado automaticamente; não confundir com
// o X-API-KEY, que identifica o certificado linkado de um PSC específico.
import process from "node:process";
import { BryError } from "./bry.server";
import { getBryAccessToken } from "./authToken.server";

async function getConfig() {
  // Mesma variável usada pelo endpoint de token (authToken.server.ts) —
  // eram duas antes (INTEGRA_BRY_ENV separado), o que permitia configurar
  // o token num ambiente e a URL base do Integra Bry em outro por engano.
  const env = (process.env.BRY_ENV || "hom").toLowerCase();
  const baseUrl =
    process.env.INTEGRA_BRY_BASE_URL ||
    (env === "prod"
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
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
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
   * assinatura. A doc pública não deixa 100% explícito se ela vem já nesta
   * resposta ou anexada ao redirectUri — tratamos ambos os formatos comuns
   * de resposta (`apiKey`/`api_key`/`credential`) e, se nenhum vier, quem
   * chamar precisa obtê-la a partir do callback do redirectUri.
   */
  apiKey: string | null;
  raw: unknown;
}

export interface PscCredentialInfo {
  status: string | null;
  pscName: string | null;
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
    return {
      authorizationUrl,
      apiKey: resp.apiKey ?? resp.api_key ?? resp.credential ?? null,
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

  /**
   * ⚠️ NÃO CONFIRMADO: assina o PDF usando o certificado linkado via PSC.
   *
   * A introdução do Integra Bry diz para reaproveitar os mesmos endpoints
   * de assinatura do HUB Signer (fw/v1/pdf/kms/lote/assinaturas), trocando
   * a URL base para integra(.hom).bry.com.br/api/service. O que NÃO está
   * confirmado nas páginas públicas da doc é o header exato de autenticação
   * nesse passo final. Por segurança mandamos os dois: `Authorization:
   * Bearer <access_token da aplicação>` (mesmo do restante da API) junto
   * com `X-API-KEY: <credencial do PSC linkado>` (como em /auth/info e
   * /auth/certificate). Deve ser validado contra a coleção Postman oficial
   * (https://integra.bry.com.br/postman.json) ou em homologação antes de
   * ir para produção — por isso lança um erro explícito se a resposta não
   * vier no formato esperado, em vez de assumir sucesso silenciosamente.
   */
  async signPdf(input: {
    apiKey: string;
    pdfBuffer: Uint8Array;
    filename: string;
    reason?: string;
  }): Promise<{ signedPdf: Uint8Array; signatureTimestamp: string | null }> {
    const { baseUrl, token } = await getConfig();
    const dadosAssinatura = {
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
      res = await fetch(`${baseUrl}/fw/v1/pdf/kms/lote/assinaturas`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-API-KEY": input.apiKey,
          Accept: "application/json",
        },
        body: form,
      });
    } catch (e) {
      throw new BryError("Não foi possível contatar o Integra Bry para assinar.", 502, String(e));
    }

    const text = await res.text();
    if (!res.ok) {
      throw new BryError(
        `Integra Bry retornou ${res.status} ao assinar. Contrato do endpoint de assinatura ` +
          "ainda não confirmado com o time de integração da Bry — ver comentário em signPdf().",
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
