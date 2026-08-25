// Facade used by server routes / server functions.
// Screens must NEVER import a provider or the repository directly — only this
// service. Provider selection is centralized in CertificateProviderFactory.
import { CertificateProviderFactory } from "./CertificateProviderFactory";
import { CredentialRepository } from "./CredentialRepository";
import { IntegraICPProvider } from "./IntegraICPProvider";
import { SignatureErrors } from "./errors";
import type { StoredCertificate, SignedDocument } from "./CertificateProvider";
import type { AuthenticateInput, AuthenticateResult } from "./types";

/** Upload compartilhado por signDocument() e finalizeA3ExternoSignature(). */
async function uploadSignedPdf(
  doctorId: string,
  filename: string | undefined,
  signed: SignedDocument,
): Promise<{ signedPdfUrl: string; signaturePath: string; signatureTimestamp: string | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const safeName = (filename ?? `documento_${Date.now()}.pdf`).replace(/[^\w.-]+/g, "_");
  const path = `${doctorId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("signed-documents")
    .upload(path, signed.signedPdf, { contentType: "application/pdf", upsert: false });
  if (upErr) throw upErr;

  const { data: signedUrl, error: urlErr } = await supabaseAdmin.storage
    .from("signed-documents")
    .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
  if (urlErr) throw urlErr;

  return {
    signedPdfUrl: signedUrl.signedUrl,
    signaturePath: path,
    signatureTimestamp: signed.signatureTimestamp,
  };
}

export const SignatureService = {
  /** Cloud enrollment via IntegraICP (fluxo legado, requer secrets da IntegraICP). */
  async authenticate(input: AuthenticateInput): Promise<AuthenticateResult> {
    const provider = await CertificateProviderFactory.getById("integra_icp");
    return (await provider.authenticate(input)) as AuthenticateResult;
  },

  /** Cloud enrollment via BRy (BRyKMS) — padrão do app. certificateType: "a1" | "a3". */
  async registerBryCloudCertificate(input: {
    doctorId: string;
    cpf: string;
    uuidCert?: string | null;
    label?: string | null;
    holderName?: string | null;
    certificateType?: "a1" | "a3";
  }) {
    const provider = await CertificateProviderFactory.getById("bry_cloud");
    return provider.authenticate(input as never);
  },

  /** A3 externo (token/smartcard local) — só registra o rótulo, sem segredo algum. */
  async registerBryA3ExternoCertificate(input: {
    doctorId: string;
    holderDocument: string;
    holderName?: string | null;
    label?: string | null;
  }) {
    const provider = await CertificateProviderFactory.getById("bry_a3_externo");
    return provider.authenticate(input as never);
  },

  /**
   * Fase 1 do fluxo A3 externo: prepara o placeholder PAdES e devolve o
   * digest que o navegador deve assinar com o token/smartcard local.
   */
  async prepareA3ExternoSignSession(req: {
    doctorId: string;
    documentId: string;
    pdfBuffer: Uint8Array;
    contentDescription?: string;
  }): Promise<{ signSessionId: string; digestBase64: string }> {
    const cert = await CredentialRepository.getActiveCertificate(req.doctorId);
    if (!cert || (cert as StoredCertificate).provider !== "bry_a3_externo") {
      throw SignatureErrors.NotConfigured("Nenhum certificado A3 externo vinculado.");
    }
    const reason = req.contentDescription ?? "Assinatura ICP-Brasil";
    const { preparePlaceholder } = await import("./PadesEmbedder.server");
    const { placeholderPdf, digestBase64 } = await preparePlaceholder({
      pdfBuffer: req.pdfBuffer,
      reason,
      name: (cert as StoredCertificate).certificate_subject ?? "Médico",
    });
    const signSessionId = await CredentialRepository.createSignSession({
      doctorId: req.doctorId,
      documentId: req.documentId,
      digestBase64,
      placeholderPdf,
      reason,
      signerName: (cert as StoredCertificate).certificate_subject ?? null,
    });
    return { signSessionId, digestBase64 };
  },

  /**
   * Fase 2 do fluxo A3 externo: recebe o CMS já assinado localmente e
   * finaliza o PDF, seguindo o mesmo caminho de upload de signDocument().
   */
  async finalizeA3ExternoSignature(req: {
    doctorId: string;
    signSessionId: string;
    cmsBase64: string;
    filename?: string;
  }): Promise<{ signedPdfUrl: string; signaturePath: string; signatureTimestamp: string | null }> {
    const cert = await CredentialRepository.getActiveCertificate(req.doctorId);
    if (!cert) throw SignatureErrors.CredentialExpired("Nenhum certificado ativo.");
    const provider = await CertificateProviderFactory.getById("bry_a3_externo");
    const signed = await provider.signDocument({
      certificate: cert as StoredCertificate,
      documentId: req.signSessionId,
      pdfBuffer: new Uint8Array(0),
      contentDescription: "Assinatura ICP-Brasil",
      externalSignatureCms: req.cmsBase64,
      signSessionId: req.signSessionId,
    });
    return uploadSignedPdf(req.doctorId, req.filename, signed);
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
    const cert = await CredentialRepository.getActiveCertificate(req.doctorId);
    if (!cert) throw SignatureErrors.CredentialExpired("Nenhum certificado ativo.");
    const provider = await CertificateProviderFactory.get(cert as StoredCertificate);
    const signed = await provider.signDocument({
      certificate: cert as StoredCertificate,
      documentId: req.documentId,
      pdfBuffer: req.pdfBuffer,
      contentDescription: req.contentDescription ?? "Assinatura ICP-Brasil",
      secret: req.certificatePassword ?? null,
    });
    return uploadSignedPdf(req.doctorId, req.filename ?? `documento_${req.documentId}.pdf`, signed);
  },
};
