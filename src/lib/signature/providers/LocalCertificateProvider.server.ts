// Local ICP-Brasil certificates (.pfx / .p12) as a CertificateProvider.
// The file lives ONLY in private Storage; the password is never persisted
// and buffers are wiped after use.
import forge from "node-forge";
import { CredentialRepository } from "../CredentialRepository";
import { SignatureErrors } from "../errors";
import {
  baseCertificateInformation,
  type CertificateInformation,
  type CertificateProvider,
  type SignDocumentParams,
  type SignedDocument,
  type StoredCertificate,
  type ValidationResult,
} from "../CertificateProvider";

export const PROVIDER_ID = "local";
export const BUCKET = "doctor-certificates";
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  "application/x-pkcs12",
  "application/pkcs12",
  "application/octet-stream",
  "",
]);

interface ParsedPfx {
  key: forge.pki.PrivateKey;
  cert: forge.pki.Certificate;
  chain: forge.pki.Certificate[];
}

function binaryFromBytes(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return s;
}

function attrValue(attrs: forge.pki.CertificateField[], name: string): string | null {
  const f = attrs.find((a) => a.name === name || a.shortName === name);
  return (f?.value as string) ?? null;
}

function subjectToString(attrs: forge.pki.CertificateField[]): string {
  return attrs
    .map((a) => `${a.shortName || a.name}=${a.value}`)
    .filter(Boolean)
    .join(", ");
}

/** ICP-Brasil encodes CPF/CNPJ inside otherName extensions of the SAN. */
function extractHolderDocument(cert: forge.pki.Certificate): string | null {
  try {
    const san = cert.getExtension("subjectAltName") as { altNames?: Array<{ value?: string }> } | null;
    const joined = (san?.altNames ?? []).map((a) => a.value ?? "").join(" ");
    const digits = joined.match(/\d{11,}/g) ?? [];
    for (const d of digits) {
      if (d.length >= 11) return d.slice(0, d.length === 11 ? 11 : 14);
    }
  } catch {
    /* ignore */
  }
  const cn = attrValue(cert.subject.attributes, "commonName") ?? "";
  const m = cn.match(/(\d{11}|\d{14})/);
  return m ? m[1] : null;
}

function parsePfx(bytes: Uint8Array, password: string): ParsedPfx {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(binaryFromBytes(bytes)));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (e) {
    const msg = String(e);
    if (/mac|password|invalid password/i.test(msg)) {
      throw SignatureErrors.InvalidPKCE("Senha do certificado inválida.");
    }
    throw SignatureErrors.InvalidDigest("Arquivo de certificado inválido ou corrompido.");
  }

  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ??
    [];
  const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  const key = (keyBags[0]?.key ?? plainKeyBags[0]?.key) as forge.pki.PrivateKey | undefined;
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const chain = certBags.map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  // The signing certificate is the one matching the private key (has a CN and is a leaf).
  const cert =
    chain.find((c) => c.getExtension("subjectAltName")) ?? chain[0];

  if (!key || !cert) {
    throw SignatureErrors.InvalidDigest("Certificado ou chave privada não encontrados no arquivo.");
  }
  return { key, cert, chain };
}

function certificateMetadata(cert: forge.pki.Certificate) {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = forge.md.sha256
    .create()
    .update(der)
    .digest()
    .toHex()
    .toUpperCase()
    .replace(/(.{2})(?=.)/g, "$1:");
  return {
    subject:
      attrValue(cert.subject.attributes, "commonName") ?? subjectToString(cert.subject.attributes),
    issuer:
      attrValue(cert.issuer.attributes, "commonName") ?? subjectToString(cert.issuer.attributes),
    serial: (cert.serialNumber || "").toUpperCase(),
    fingerprint,
    validFrom: cert.validity.notBefore?.toISOString() ?? null,
    validUntil: cert.validity.notAfter?.toISOString() ?? null,
    holderDocument: extractHolderDocument(cert),
  };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const LocalCertificateProvider: CertificateProvider = {
  id: PROVIDER_ID,

  /**
   * Enrollment for local certificates:
   * validates extension/MIME/size, validates the password by opening the
   * PKCS#12, extracts metadata, uploads the file to private Storage and
   * persists ONLY path + metadata.
   */
  async authenticate(input) {
    const {
      doctorId,
      fileBase64,
      filename,
      mimeType,
      password,
      label,
    } = input as unknown as {
      doctorId: string;
      fileBase64: string;
      filename: string;
      mimeType?: string;
      password: string;
      label?: string;
    };

    if (!password) throw SignatureErrors.InvalidPKCE("Senha do certificado é obrigatória.");
    const ext = (filename || "").toLowerCase().match(/\.(pfx|p12)$/);
    if (!ext) throw SignatureErrors.InvalidDigest("Envie um arquivo .pfx ou .p12.");
    if (mimeType !== undefined && !ALLOWED_MIME.has(mimeType)) {
      throw SignatureErrors.InvalidDigest("Tipo de arquivo não permitido.");
    }

    const bin = atob(fileBase64.includes(",") ? fileBase64.slice(fileBase64.indexOf(",") + 1) : fileBase64);
    if (bin.length > MAX_FILE_BYTES) {
      throw SignatureErrors.InvalidDigest("Arquivo maior que 5 MB.");
    }
    let bytes: Uint8Array | null = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    try {
      const { cert } = parsePfx(bytes, password);
      const meta = certificateMetadata(cert);
      if (meta.validUntil && new Date(meta.validUntil).getTime() < Date.now()) {
        throw SignatureErrors.CredentialExpired("Certificado vencido.");
      }

      const sb = await admin();
      const path = `${doctorId}/${Date.now()}_certificado${ext[0]}`;
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "application/x-pkcs12", upsert: false });
      if (upErr) throw upErr;

      const credentialId = `local:${path}`;
      await CredentialRepository.upsertLocalCertificate({
        doctorId,
        credentialId,
        storagePath: path,
        label: label ?? null,
        subject: meta.subject,
        serial: meta.serial,
        fingerprint: meta.fingerprint,
        issuer: meta.issuer,
        holderDocument: meta.holderDocument,
        validFrom: meta.validFrom,
        validUntil: meta.validUntil,
      });

      return {
        ok: true,
        certificateType: "pfx",
        provider: PROVIDER_ID,
        subject: meta.subject,
        issuer: meta.issuer,
        serial: meta.serial,
        fingerprint: meta.fingerprint,
        holderDocument: meta.holderDocument,
        validFrom: meta.validFrom,
        validUntil: meta.validUntil,
      };
    } finally {
      if (bytes) bytes.fill(0);
      bytes = null;
    }
  },

  async validateCertificate(certificate: StoredCertificate): Promise<ValidationResult> {
    if (!certificate.storage_path) {
      return { valid: false, code: "not_configured", reason: "Arquivo do certificado ausente." };
    }
    if (
      certificate.certificate_valid_until &&
      new Date(certificate.certificate_valid_until).getTime() < Date.now()
    ) {
      return { valid: false, code: "credential_expired", reason: "Certificado vencido." };
    }
    return { valid: true };
  },

  async signDocument(params: SignDocumentParams): Promise<SignedDocument> {
    const cert = params.certificate;
    const check = await this.validateCertificate(cert);
    if (!check.valid) throw SignatureErrors.CredentialExpired(check.reason);
    if (!params.secret) {
      throw new (await import("../errors")).SignatureError(
        "password_required",
        "Informe a senha do certificado para assinar.",
        428,
      );
    }

    const sb = await admin();
    const { data: file, error } = await sb.storage.from(BUCKET).download(cert.storage_path!);
    if (error || !file) throw SignatureErrors.ProviderUnavailable("Falha ao ler o certificado.");
    let pfxBytes: Uint8Array | null = new Uint8Array(await file.arrayBuffer());

    try {
      const { key, cert: x509, chain } = parsePfx(pfxBytes, params.secret);
      const { embedCMSIntoPDF } = await import("../PadesEmbedder.server");
      return await embedCMSIntoPDF({
        pdfBuffer: params.pdfBuffer,
        reason: params.contentDescription,
        name: cert.certificate_subject ?? "Médico",
        signer: async ({ bytes }) => {
          const p7 = forge.pkcs7.createSignedData();
          p7.content = forge.util.createBuffer(binaryFromBytes(bytes));
          for (const c of chain) p7.addCertificate(c);
          p7.addSigner({
            key: key as forge.pki.rsa.PrivateKey,
            certificate: x509,
            digestAlgorithm: forge.pki.oids.sha256,
            authenticatedAttributes: [
              { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
              { type: forge.pki.oids.messageDigest },
              { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
            ],
          });
          p7.sign({ detached: true });
          return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
        },
      });
    } finally {
      if (pfxBytes) pfxBytes.fill(0);
      pfxBytes = null;
    }
  },

  async revokeAuthentication(certificate: StoredCertificate): Promise<void> {
    if (certificate.storage_path) {
      const sb = await admin();
      await sb.storage.from(BUCKET).remove([certificate.storage_path]);
    }
    await CredentialRepository.deleteCertificate(certificate.doctor_id, certificate.id);
  },

  getCertificateInformation(certificate: StoredCertificate): CertificateInformation {
    return baseCertificateInformation(certificate, PROVIDER_ID);
  },
};