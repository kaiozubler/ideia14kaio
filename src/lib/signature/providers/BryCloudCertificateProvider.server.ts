// Certificado ICP-Brasil em nuvem via BRy (BRyKMS).
// O vínculo guarda apenas CPF do titular + UUID opcional do certificado.
// O PIN é solicitado a cada assinatura e NUNCA é persistido.
import { CredentialRepository } from "../CredentialRepository";
import { SignatureError, SignatureErrors } from "../errors";
import {
  baseCertificateInformation,
  type CertificateInformation,
  type CertificateProvider,
  type SignDocumentParams,
  type SignedDocument,
  type StoredCertificate,
  type ValidationResult,
} from "../CertificateProvider";

export const PROVIDER_ID = "bry_cloud";
const PROVIDER_NAME = "BRy Cloud (Certificado em Nuvem)";
const PRODUCT_NAME = "BRyKMS";

export const BryCloudCertificateProvider: CertificateProvider = {
  id: PROVIDER_ID,

  async authenticate(input) {
    const { doctorId, cpf, uuidCert, label, holderName } = input as unknown as {
      doctorId: string;
      cpf?: string;
      uuidCert?: string | null;
      label?: string | null;
      holderName?: string | null;
    };

    const digits = (cpf ?? "").replace(/\D/g, "");
    if (digits.length !== 11) {
      throw new SignatureError("invalid_cpf", "Informe um CPF válido (11 dígitos).", 400);
    }
    // Garante que a integração está configurada antes de vincular.
    const { BryKmsApi } = await import("@/lib/bry/kms.server");
    void BryKmsApi;

    await CredentialRepository.upsertCloudCertificate({
      doctorId,
      provider: PROVIDER_ID,
      credentialId: `bry_cloud:${uuidCert || digits}`,
      label: label ?? null,
      holderDocument: digits,
      subject: holderName ?? null,
      providerName: PROVIDER_NAME,
      productName: PRODUCT_NAME,
      uuidCert: uuidCert ?? null,
    });

    return {
      ok: true,
      provider: PROVIDER_ID,
      certificateType: "cloud",
      requiresPin: true,
      holderDocument: digits,
    };
  },

  async validateCertificate(certificate: StoredCertificate): Promise<ValidationResult> {
    if (!certificate.holder_document) {
      return { valid: false, code: "not_configured", reason: "CPF do titular ausente." };
    }
    return { valid: true };
  },

  async signDocument(params: SignDocumentParams): Promise<SignedDocument> {
    const cert = params.certificate;
    const check = await this.validateCertificate(cert);
    if (!check.valid) throw SignatureErrors.NotConfigured(check.reason);
    if (!params.secret) {
      throw new SignatureError(
        "password_required",
        "Informe o PIN do certificado em nuvem para assinar.",
        428,
      );
    }

    const uuidCert =
      (cert.raw_metadata as { uuid_cert?: string | null } | null)?.uuid_cert ??
      (cert.credential_id?.startsWith("bry_cloud:") &&
      cert.credential_id.slice(10).replace(/\D/g, "").length !== 11
        ? cert.credential_id.slice(10)
        : null);

    const { BryKmsApi } = await import("@/lib/bry/kms.server");
    const result = await BryKmsApi.signPdf({
      user: String(cert.holder_document).replace(/\D/g, ""),
      pin: params.secret,
      uuidCert,
      pdfBuffer: params.pdfBuffer,
      filename: `${params.documentId}.pdf`,
      reason: params.contentDescription,
    });

    return { signedPdf: result.signedPdf, signatureTimestamp: result.signatureTimestamp };
  },

  async revokeAuthentication(certificate: StoredCertificate): Promise<void> {
    await CredentialRepository.deleteCertificate(certificate.doctor_id, certificate.id);
  },

  getCertificateInformation(certificate: StoredCertificate): CertificateInformation {
    return baseCertificateInformation(certificate, PROVIDER_ID);
  },
};
