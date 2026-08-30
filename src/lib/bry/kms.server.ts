// BRy HUB Signer — assinatura PAdES com certificado em nuvem (BRyKMS).
// Server-only: o token e o PIN nunca trafegam pelo frontend sem TLS interno.
import process from "node:process";
import { BryError } from "./bry.server";
import { getBryAccessToken } from "./authToken.server";

const DEFAULT_HUB = "https://hub2.bry.com.br";

async function getHubConfig() {
  // Preferência: token OAuth2 renovado automaticamente (ver authToken.server.ts).
  // Fallback: BRY_HUB_TOKEN/BRY_API_TOKEN estático, só pra quem ainda não
  // migrou para BRY_CLIENT_ID/BRY_CLIENT_SECRET.
  let token: string;
  try {
    token = await getBryAccessToken();
  } catch (err) {
    const fallback = process.env.BRY_HUB_TOKEN || process.env.BRY_API_TOKEN;
    if (!fallback) throw err;
    token = fallback;
  }
  const baseUrl = (process.env.BRY_HUB_BASE_URL || DEFAULT_HUB).replace(/\/+$/, "");
  return { token, baseUrl };
}

export interface BryKmsSignInput {
  /** CPF do titular do certificado no BRyKMS (somente dígitos). */
  user: string;
  /** PIN/senha do certificado em nuvem — enviado em Base64, nunca persistido. */
  pin: string;
  /** UUID do certificado no BRyKMS (opcional). */
  uuidCert?: string | null;
  pdfBuffer: Uint8Array;
  filename: string;
  reason?: string;
}

export interface BryKmsSignResult {
  signedPdf: Uint8Array;
  signatureTimestamp: string | null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const BryKmsApi = {
  /** Assina um PDF (PAdES) usando o certificado do titular armazenado no BRyKMS. */
  async signPdf(input: BryKmsSignInput): Promise<BryKmsSignResult> {
    const { token, baseUrl } = await getHubConfig();
    const dadosAssinatura = {
      kms_data: {
        user: input.user,
        ...(input.uuidCert ? { uuid_cert: input.uuidCert } : {}),
        pin: btoa(input.pin),
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

    const url = `${baseUrl}/fw/v1/pdf/kms/lote/assinaturas`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          kms_type: "BRYKMS",
          Accept: "application/json",
        },
        body: form,
      });
    } catch (e) {
      console.error("[bry:kms] network_error", String(e));
      throw new BryError("Não foi possível contatar o serviço de assinatura em nuvem.", 502);
    }

    const text = await res.text();
    if (!res.ok) {
      console.error("[bry:kms] api_error", res.status, text.slice(0, 600));
      let message = "O serviço de assinatura em nuvem retornou um erro.";
      if (res.status === 401 || res.status === 403) {
        message = "PIN do certificado em nuvem inválido ou acesso não autorizado.";
      }
      try {
        const j = JSON.parse(text) as { message?: string };
        if (j.message) message = j.message;
      } catch {
        /* keep default */
      }
      // Erro típico: o token do HUB pertence a uma conta sem certificado em nuvem
      // vinculado, ou o CPF informado não possui certificado no BRyKMS.
      if (/não possui certificado em nuvem|certificado em nuvem/i.test(message)) {
        throw new BryError(
          "O CPF vinculado não possui certificado ICP-Brasil em nuvem ativo na BRy. " +
            "Verifique o CPF/UUID do certificado em Configurações > Assinatura digital, " +
            "ou use um certificado local (.pfx/.p12).",
          409,
        );
      }
      throw new BryError(message, res.status >= 400 && res.status < 500 ? res.status : 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    // tipoRetorno BASE64 devolve uma lista de arquivos assinados em Base64.
    const first = Array.isArray(parsed)
      ? parsed[0]
      : (parsed as { documentos?: Array<{ documento?: string }> } | null)?.documentos?.[0]
          ?.documento;
    const b64 = typeof first === "string" ? first : (first as { documento?: string })?.documento;
    if (!b64) {
      console.error("[bry:kms] empty_response", text.slice(0, 300));
      throw new BryError("O serviço de assinatura não retornou o documento assinado.", 502);
    }

    return { signedPdf: base64ToBytes(b64), signatureTimestamp: new Date().toISOString() };
  },

  /** Utilitário para depuração / logs — não expõe o PIN. */
  encodePdf(bytes: Uint8Array) {
    return bytesToBase64(bytes);
  },
};
