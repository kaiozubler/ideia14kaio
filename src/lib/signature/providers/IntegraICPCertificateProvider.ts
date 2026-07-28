// Cloud ICP-Brasil certificates (IntegraICP v3) as a CertificateProvider.
// Wraps the existing IntegraICP HTTP client — behavior is unchanged.
import { CredentialRepository } from "../CredentialRepository";
import { IntegraICPProvider } from "../IntegraICPProvider";
import { generatePKCE } from "../PKCEService";
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
import type { AuthenticateInput, AuthenticateResult } from "../types";

export const PROVIDER_ID = "integra_icp";

export const IntegraICPCertificateProvider: CertificateProvider = {
  id: PROVIDER_ID,

  async authenticate(input): Promise<AuthenticateResult> {
    const i = input as AuthenticateInput;
    if (!i.cpf) throw SignatureErrors.InvalidPKCE("CPF requerido.");
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const sessionId = await CredentialRepository.createPkceSession({
      doctorId: i.doctorId,
      codeVerifier,
    });

    // Append session id so the callback can find the PKCE row.
    const cb = new URL(i.callbackUrl);
    cb.searchParams.set("session", sessionId);

    const { requestId, clearances } = await IntegraICPProvider.authenticate({
      cpf: i.cpf,
      codeChallenge,
      callbackUrl: cb.toString(),
    });

    if (requestId) await CredentialRepository.attachRequestId(sessionId, requestId);

    const redirectUrl =
      clearances.length === 1 ? clearances[0].authorizationUrl || null : null;

    return { requestId, sessionId, clearances, redirectUrl };
  },

  async validateCertificate(certificate: StoredCertificate): Promise<ValidationResult> {
    if (
      certificate.credential_expires_at &&
      new Date(certificate.credential_expires_at).getTime() < Date.now()
    ) {
      return { valid: false, code: "credential_expired", reason: "Credencial expirada." };
    }
    return { valid: true };
  },

  async signDocument(params: SignDocumentParams): Promise<SignedDocument> {
    const cert = params.certificate;
    const check = await this.validateCertificate(cert);
    if (!check.valid) throw SignatureErrors.CredentialExpired(check.reason);

    const active = await CredentialRepository.getActiveCertificateWithVerifier(cert.doctor_id);
    const codeVerifier = active?.codeVerifier ?? null;
    if (!codeVerifier) {
      throw SignatureErrors.InvalidPKCE(
        "Verificador PKCE ausente para este certificado. Reconecte o certificado.",
      );
    }

    const { embedCMSIntoPDF } = await import("../PadesEmbedder.server");
    return embedCMSIntoPDF({
      pdfBuffer: params.pdfBuffer,
      reason: params.contentDescription,
      name: cert.certificate_subject ?? "Médico",
      signer: async ({ digestBase64 }) => {
        const result = await IntegraICPProvider.sign({
          credentialId: cert.credential_id,
          codeVerifier,
          documentId: params.documentId,
          contentDigest: digestBase64,
          contentDescription: params.contentDescription,
        });
        return result.signedContent; // base64 CMS
      },
    });
  },

  async revokeAuthentication(certificate: StoredCertificate): Promise<void> {
    // Cloud credentials expire on their own; we only drop the local reference.
    await CredentialRepository.deleteCertificate(certificate.doctor_id, certificate.id);
  },

  getCertificateInformation(certificate: StoredCertificate): CertificateInformation {
    return baseCertificateInformation(certificate, PROVIDER_ID);
  },
};