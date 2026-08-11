// Facade used by server routes / server functions.
// Screens must NEVER import a provider or the repository directly — only this
// service. Provider selection is centralized in CertificateProviderFactory.
import { CertificateProviderFactory } from "./CertificateProviderFactory";
import { CredentialRepository } from "./CredentialRepository";
import { IntegraICPProvider } from "./IntegraICPProvider";
import { SignatureErrors, SignatureError } from "./errors";
import { AuditRepository, sha256Hex } from "./AuditRepository";
import type { StoredCertificate } from "./CertificateProvider";
import type { AuthenticateInput, AuthenticateResult } from "./types";

export const SignatureService = {
  /** Cloud enrollment via IntegraICP (fluxo legado, requer secrets da IntegraICP). */
  async authenticate(input: AuthenticateInput): Promise<AuthenticateResult> {
    const provider = await CertificateProviderFactory.getById("integra_icp");
    return (await provider.authenticate(input)) as AuthenticateResult;
  },

  /** Cloud enrollment via BRy (BRyKMS) — padrão do app. */
  async registerBryCloudCertificate(input: {
    doctorId: string;
    cpf: string;
    uuidCert?: string | null;
    label?: string | null;
    holderName?: string | null;
  }) {
    const provider = await CertificateProviderFactory.getById("bry_cloud");
    return provider.authenticate(input as never);
  },

  /** Local (.pfx/.p12) enrollment. */
  async registerLocalCertificate(input: {
    doctorId: string;
    fileBase64: string;
    filename: string;
    mimeType?: string;
    password: string;
    label?: string;
  }) {
    const provider = await CertificateProviderFactory.getById("local");
    return provider.authenticate(input as never);
  },

  async handleCallback(params: { credentialId: string; sessionId?: string; requestId?: string }) {
    const { doctorId, codeVerifier } = await CredentialRepository.consumeVerifier({
      sessionId: params.sessionId,
      requestId: params.requestId,
    });
    const cred = await IntegraICPProvider.fetchCredential({
      credentialId: params.credentialId,
      codeVerifier,
    });
    // Store the verifier alongside the credential so we can sign new
    // documents within the credential lifetime without a new auth flow.
    await CredentialRepository.upsertCertificate(doctorId, cred, codeVerifier);
    return { doctorId, credential: cred };
  },

  async getCredential(doctorId: string) {
    const cert = await CredentialRepository.getActiveCertificate(doctorId);
    if (!cert) return null;
    const provider = await CertificateProviderFactory.get(cert as StoredCertificate);
    const info = provider.getCertificateInformation(cert as StoredCertificate);
    // Never expose secrets / raw material to the frontend.
    const safe = { ...(cert as Record<string, unknown>) };
    delete safe.code_verifier_encrypted;
    delete safe.raw_metadata;
    return { ...safe, expired: info.expired, info };
  },

  async removeCredential(doctorId: string) {
    const cert = await CredentialRepository.getActiveCertificate(doctorId);
    if (!cert) return { removed: false };
    const provider = await CertificateProviderFactory.get(cert as StoredCertificate);
    await provider.revokeAuthentication(cert as StoredCertificate);
    return { removed: true };
  },

  async signDocument(req: {
    doctorId: string;
    documentId: string;
    pdfBuffer: Uint8Array;
    contentDescription?: string;
    filename?: string;
    certificatePassword?: string | null;
  }): Promise<{ signedPdfUrl: string; signaturePath: string; signatureTimestamp: string | null }> {
    // Hash do documento ORIGINAL (antes de assinar) — usado só na auditoria,
    // nunca exposto ao usuário. Não é a senha/PIN nem o certificado.
    const documentHash = await sha256Hex(req.pdfBuffer.slice().buffer);

    const cert = await CredentialRepository.getActiveCertificate(req.doctorId);
    if (!cert) {
      await AuditRepository.log({
        userId: req.doctorId,
        documentId: req.documentId,
        documentHash,
        signatureStatus: "failed",
        errorCode: "credential_expired",
        errorMessage: "Nenhum certificado ativo.",
      });
      throw SignatureErrors.CredentialExpired("Nenhum certificado ativo.");
    }
    const storedCert = cert as StoredCertificate;
    const provider = await CertificateProviderFactory.get(storedCert);

    let signed: Awaited<ReturnType<typeof provider.signDocument>>;
    try {
      signed = await provider.signDocument({
        certificate: storedCert,
        documentId: req.documentId,
        pdfBuffer: req.pdfBuffer,
        contentDescription: req.contentDescription ?? "Assinatura ICP-Brasil",
        secret: req.certificatePassword ?? null,
      });
    } catch (err) {
      const e = err as SignatureError & { name?: string; status?: number; message?: string };
      await AuditRepository.log({
        userId: req.doctorId,
        documentId: req.documentId,
        certificateId: storedCert.id ?? null,
        certificateType: storedCert.certificate_type ?? null,
        provider: storedCert.provider ?? null,
        documentHash,
        signatureStatus: "failed",
        errorCode: e?.code ?? (e?.name === "BryError" ? "bry_error" : "unknown_error"),
        errorMessage: e?.message,
      });
      throw err;
    }

    // Upload the signed PDF to Storage (private bucket, per-doctor folder).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safeName = (req.filename ?? `documento_${req.documentId}.pdf`).replace(/[^\w.\-]+/g, "_");
    const path = `${req.doctorId}/${Date.now()}_${safeName}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("signed-documents")
      .upload(path, signed.signedPdf, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upErr) {
      await AuditRepository.log({
        userId: req.doctorId,
        documentId: req.documentId,
        certificateId: storedCert.id ?? null,
        certificateType: storedCert.certificate_type ?? null,
        provider: storedCert.provider ?? null,
        documentHash,
        signatureStatus: "failed",
        errorCode: "storage_upload_failed",
        errorMessage: upErr.message,
      });
      throw upErr;
    }

    const { data: signedUrl, error: urlErr } = await supabaseAdmin.storage
      .from("signed-documents")
      .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
    if (urlErr) throw urlErr;

    await AuditRepository.log({
      userId: req.doctorId,
      documentId: req.documentId,
      certificateId: storedCert.id ?? null,
      certificateType: storedCert.certificate_type ?? null,
      provider: storedCert.provider ?? null,
      documentHash,
      signatureStatus: "success",
      signedDocumentPath: path,
    });
    if (storedCert.id) await AuditRepository.touchLastUsed(storedCert.id);

    return {
      signedPdfUrl: signedUrl.signedUrl,
      signaturePath: path,
      signatureTimestamp: signed.signatureTimestamp,
    };
  },
};