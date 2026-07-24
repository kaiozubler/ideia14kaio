// IntegraICP v3 HTTP provider.
// Secrets read per-request (Cloudflare Workers env binds at request time).
import { SignatureErrors } from "./errors";
import type { CredentialData, Clearance, SignatureProvider, SignResult } from "./types";

function requireConfig() {
  const channelId = process.env.INTEGRAICP_CHANNEL_ID;
  const apiKey = process.env.INTEGRAICP_API_KEY;
  const baseUrl = process.env.INTEGRAICP_BASE_URL || "https://api.integraicp.com";
  if (!channelId || !apiKey) {
    throw SignatureErrors.NotConfigured(
      "INTEGRAICP_CHANNEL_ID e/ou INTEGRAICP_API_KEY não configurados.",
    );
  }
  return { channelId, apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
}

async function callIntegra<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const { apiKey, baseUrl } = requireConfig();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw SignatureErrors.ProviderUnavailable("Falha de rede ao contatar IntegraICP.", String(e));
  }

  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw SignatureErrors.CredentialExpired(`IntegraICP retornou ${res.status}.`);
    }
    if (res.status === 408 || res.status === 504) throw SignatureErrors.Timeout();
    throw SignatureErrors.ProviderUnavailable(
      `IntegraICP retornou ${res.status}.`,
      json ?? text,
    );
  }
  return json as T;
}

export const IntegraICPProvider: SignatureProvider = {
  async authenticate({ cpf, codeChallenge, callbackUrl }) {
    const { channelId } = requireConfig();
    type Resp = {
      request_id?: string;
      requestId?: string;
      clearances?: Array<{
        provider?: string;
        product?: string;
        authorization_uri?: string;
        authorizationUri?: string;
        authorization_url?: string;
      }>;
    };
    const resp = await callIntegra<Resp>(
      "POST",
      `/c/${encodeURIComponent(channelId)}/icp/v3/authentications`,
      {
        subject_key: cpf.replace(/\D/g, ""),
        subject_type: "CPF",
        secret_data: codeChallenge,
        secret_type: "code_challenge",
        callback_uri: callbackUrl,
        credential_lifetime: 604800,
        autostart: true,
      },
    );

    const clearances: Clearance[] = (resp.clearances ?? []).map((c) => ({
      provider: c.provider ?? "unknown",
      product: c.product,
      authorizationUrl:
        c.authorization_uri ?? c.authorizationUri ?? c.authorization_url ?? "",
      raw: c,
    }));

    return {
      requestId: resp.request_id ?? resp.requestId ?? "",
      clearances,
    };
  },

  async fetchCredential({ credentialId, codeVerifier }) {
    const { channelId } = requireConfig();
    // v3 uses secret_data on credential retrieval to unwrap the credential.
    type Resp = {
      credential_id?: string;
      id?: string;
      provider?: string;
      product?: string;
      certificate?: {
        subject_name?: string;
        subjectName?: string;
        serial_number?: string;
        serialNumber?: string;
        fingerprint256?: string;
        fingerprint_sha256?: string;
        valid_from?: string;
        validFrom?: string;
        not_before?: string;
        valid_until?: string;
        validUntil?: string;
        not_after?: string;
      };
      expires_at?: string;
      credential_expires_at?: string;
    };
    const params = new URLSearchParams({
      secret_data: codeVerifier,
      secret_type: "code_verifier",
    });
    const resp = await callIntegra<Resp>(
      "GET",
      `/c/${encodeURIComponent(channelId)}/icp/v3/credentials/${encodeURIComponent(
        credentialId,
      )}?${params.toString()}`,
    );

    const cert = resp.certificate ?? {};
    const data: CredentialData = {
      credentialId: resp.credential_id ?? resp.id ?? credentialId,
      providerName: resp.provider ?? null,
      productName: resp.product ?? null,
      certificateSubject: cert.subject_name ?? cert.subjectName ?? null,
      certificateSerial: cert.serial_number ?? cert.serialNumber ?? null,
      certificateFingerprint: cert.fingerprint256 ?? cert.fingerprint_sha256 ?? null,
      certificateValidFrom: cert.valid_from ?? cert.validFrom ?? cert.not_before ?? null,
      certificateValidUntil: cert.valid_until ?? cert.validUntil ?? cert.not_after ?? null,
      credentialExpiresAt: resp.credential_expires_at ?? resp.expires_at ?? null,
      raw: resp,
    };
    return data;
  },

  async sign({ credentialId, codeVerifier, documentId, contentDigest, contentDescription }) {
    const { channelId } = requireConfig();
    type Resp = {
      results?: Array<{
        signed_content?: string;
        signedContent?: string;
        signature_timestamp?: string;
        signatureTimestamp?: string;
      }>;
    };
    const resp = await callIntegra<Resp>(
      "POST",
      `/c/${encodeURIComponent(channelId)}/icp/v3/signatures`,
      {
        credentialId,
        secretType: "code_verifier",
        secretData: codeVerifier,
        requests: [
          {
            contentId: documentId,
            contentDigest,
            contentDescription,
            signaturePolicy: "CMS",
          },
        ],
      },
    );
    const first = resp.results?.[0] ?? {};
    const result: SignResult = {
      signedContent: first.signed_content ?? first.signedContent ?? "",
      signatureTimestamp: first.signature_timestamp ?? first.signatureTimestamp ?? null,
      raw: resp,
    };
    if (!result.signedContent) throw SignatureErrors.ProviderUnavailable("Assinatura vazia.");
    return result;
  },
};