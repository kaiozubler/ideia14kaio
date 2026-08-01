// Server-only client for the BRY EasySign API.
// All credentials stay here; the browser never talks to BRY directly.
import process from "node:process";

export class BryError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status = 502, details?: unknown) {
    super(message);
    this.name = "BryError";
    this.status = status;
    this.details = details;
  }
}

function getConfig() {
  const baseUrl = process.env.BRY_BASE_URL;
  const token = process.env.BRY_API_TOKEN;
  if (!baseUrl || !token) {
    throw new BryError("Integração BRY não configurada (secrets ausentes).", 503);
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    clientId: process.env.BRY_CLIENT_ID ?? "",
    clientSecret: process.env.BRY_CLIENT_SECRET ?? "",
  };
}

function log(scope: string, data: Record<string, unknown>) {
  console.log(`[bry:${scope}]`, JSON.stringify(data));
}

async function bryFetch<T>(
  path: string,
  init: { method: string; body?: unknown; raw?: boolean } = { method: "GET" },
): Promise<T> {
  const cfg = getConfig();
  const url = `${cfg.baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: init.raw ? "application/octet-stream" : "application/json",
  };
  if (cfg.clientId) headers["client_id"] = cfg.clientId;
  if (cfg.clientSecret) headers["client_secret"] = cfg.clientSecret;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    log("network_error", { url, message: String(e) });
    throw new BryError("Não foi possível contatar o serviço de assinatura.", 502, String(e));
  }

  log("request", { url, method: init.method, status: res.status, ms: Date.now() - startedAt });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log("api_error", { url, status: res.status, body: text.slice(0, 800) });
    throw new BryError(
      "O serviço de assinatura retornou um erro.",
      res.status >= 400 && res.status < 500 ? res.status : 502,
      text.slice(0, 800),
    );
  }

  if (init.raw) return (await res.arrayBuffer()) as unknown as T;
  const text = await res.text();
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return {} as T;
  }
}

export type BryStatus = "PENDING" | "SIGNED" | "EXPIRED" | "CANCELLED" | "REJECTED";

export function normalizeStatus(raw: unknown): BryStatus {
  const s = String(raw ?? "").toUpperCase();
  if (["SIGNED", "CONCLUDED", "COMPLETED", "FINISHED", "ASSINADO"].includes(s)) return "SIGNED";
  if (["EXPIRED", "EXPIRADO"].includes(s)) return "EXPIRED";
  if (["CANCELLED", "CANCELED", "CANCELADO"].includes(s)) return "CANCELLED";
  if (["REJECTED", "REFUSED", "RECUSADO", "DECLINED"].includes(s)) return "REJECTED";
  return "PENDING";
}

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export interface CreateEnvelopeInput {
  documentoPdfBase64: string;
  nomePaciente: string;
  emailPaciente: string;
  tipoDocumento: string;
  filename?: string;
  callbackUrl?: string | null;
}

export interface EnvelopeResult {
  envelopeId: string;
  signUrl: string | null;
  downloadUrl: string | null;
  status: BryStatus;
  raw: unknown;
}

export const BryApi = {
  async createEnvelope(input: CreateEnvelopeInput): Promise<EnvelopeResult> {
    const payload = {
      documents: [
        {
          name: input.filename ?? `${input.tipoDocumento}.pdf`,
          content: input.documentoPdfBase64,
          contentType: "application/pdf",
        },
      ],
      signers: [
        {
          name: input.nomePaciente,
          email: input.emailPaciente,
          role: "SIGNER",
        },
      ],
      metadata: { tipoDocumento: input.tipoDocumento },
      ...(input.callbackUrl ? { callbackUrl: input.callbackUrl, webhookUrl: input.callbackUrl } : {}),
    };

    const data = await bryFetch<Record<string, unknown>>("/api/service/sign/v1/signatures", {
      method: "POST",
      body: payload,
    });

    const envelopeId = pick(data, ["id", "envelopeId", "uuid", "signatureId"]);
    if (!envelopeId) {
      throw new BryError("Resposta inválida do serviço de assinatura (sem id).", 502, data);
    }
    return {
      envelopeId,
      signUrl: pick(data, ["signUrl", "sign_url", "signatureUrl", "url", "redirectUrl"]),
      downloadUrl: pick(data, ["downloadUrl", "download_url", "documentUrl"]),
      status: normalizeStatus(data.status ?? data.state),
      raw: data,
    };
  },

  async getEnvelope(envelopeId: string): Promise<EnvelopeResult> {
    const data = await bryFetch<Record<string, unknown>>(
      `/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}`,
      { method: "GET" },
    );
    return {
      envelopeId,
      signUrl: pick(data, ["signUrl", "sign_url", "signatureUrl", "url"]),
      downloadUrl: pick(data, ["downloadUrl", "download_url", "documentUrl"]),
      status: normalizeStatus(data.status ?? data.state),
      raw: data,
    };
  },

  async cancelEnvelope(envelopeId: string): Promise<void> {
    await bryFetch(`/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}/cancel`, {
      method: "POST",
      body: {},
    });
  },

  async downloadSignedPdf(envelopeId: string, downloadUrl?: string | null): Promise<Uint8Array> {
    if (downloadUrl && /^https?:\/\//i.test(downloadUrl)) {
      const cfg = getConfig();
      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (!res.ok) {
        log("download_error", { status: res.status });
        throw new BryError("Não foi possível baixar o documento assinado.", 502);
      }
      return new Uint8Array(await res.arrayBuffer());
    }
    const buf = await bryFetch<ArrayBuffer>(
      `/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}/document`,
      { method: "GET", raw: true },
    );
    return new Uint8Array(buf);
  },
};