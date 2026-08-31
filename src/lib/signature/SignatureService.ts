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

  /**
   * A3 externo (certificado hospedado por outro PSC, não pela BRy) via
   * Integra Bry. Gera o link de autenticação com o PSC escolhido — o
   * médico abre esse link, autentica no PSC e escolhe o certificado.
   * `lifetimeSeconds` é o "tempo de vida da requisição" (180 a 604800s;
   * default 12h, o mesmo valor citado pelas outras certificadoras).
   */
  /** Lista os PSCs suportados pelo Integra Bry, para o médico escolher qual usar. */
  async listIntegraBryPscs() {
    const { IntegraBryApi } = await import("@/lib/bry/integraBry.server");
    return IntegraBryApi.listPscs();
  },

  async startIntegraBryLink(req: {
    doctorId: string;
    pscName: string;
    redirectUri: string;
    cpf?: string;
    scope?: "single_signature" | "multi_signature" | "signature_session";
    lifetimeSeconds?: number;
  }): Promise<{ sessionId: string; authorizationUrl: string; state: string }> {
    const { IntegraBryApi } = await import("@/lib/bry/integraBry.server");
    const state = crypto.randomUUID();
    const link = await IntegraBryApi.createLink({
      pscName: req.pscName,
      redirectUri: req.redirectUri,
      state,
      // Por padrão usamos "signature_session" com o lifetime máximo (7 dias)
      // para que a tela de configuração possa mostrar "conectado" por um
      // tempo razoável, como os demais tipos de certificado. Para assinar
      // documento a documento sem manter vínculo, o chamador pode passar
      // scope: "single_signature".
      scope: req.scope ?? "signature_session",
      lifetime: req.lifetimeSeconds ?? 7 * 24 * 60 * 60,
      cpf: req.cpf,
    });
    const sessionId = await CredentialRepository.createPscLinkSession({
      doctorId: req.doctorId,
      pscName: req.pscName,
      state,
      redirectUri: req.redirectUri,
      apiKey: link.apiKey,
    });
    return { sessionId, authorizationUrl: link.authorizationUrl, state };
  },

  /**
   * Chamado quando o PSC redireciona de volta (?state=...) após o médico
   * autenticar e escolher o certificado. Confirma a sessão e devolve os
   * dados do certificado escolhido (via /auth/info + /auth/certificate).
   */
  async completeIntegraBryLink(params: {
    state: string;
    /** Só necessário se o apiKey não veio na resposta de /psc/link (ver comentário em IntegraBryApi.createLink). */
    apiKeyFromCallback?: string | null;
  }) {
    const session = await CredentialRepository.getPscLinkSessionByState(params.state);
    if (!session) throw SignatureErrors.NotConfigured("Sessão de link Integra Bry não encontrada.");
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      throw SignatureErrors.Timeout("Sessão de link Integra Bry expirada. Inicie novamente.");
    }
    // Nenhum apiKey separado veio nem na resposta de /psc/link nem no
    // redirect (só ?state= volta) — hipótese: o próprio `state` que
    // geramos e enviamos serve como identificador da sessão pra /auth/info
    // e /auth/certificate (já que é único por sessão e a Bry não parece
    // devolver outra coisa). Se isso estiver errado, os dois GETs abaixo
    // vão falhar com um erro claro da Bry (401/403), não silenciosamente.
    const apiKey = session.apiKey ?? params.apiKeyFromCallback ?? params.state;
    const { IntegraBryApi } = await import("@/lib/bry/integraBry.server");
    const [info, certificate] = await Promise.all([
      IntegraBryApi.getAuthInfo(apiKey),
      IntegraBryApi.getAuthCertificate(apiKey),
    ]);
    await CredentialRepository.markPscLinkSessionLinked(session.id, apiKey, {
      subject: certificate.subject,
      holderDocument: certificate.holderDocument,
      validUntil: certificate.validUntil,
    });
    return { sessionId: session.id, pscName: session.pscName, info, certificate };
  },

  /**
   * Assina o PDF usando a sessão Integra Bry já linkada (ver aviso em
   * IntegraBryApi.signPdf sobre o contrato do passo final ainda não estar
   * 100% confirmado com a documentação autenticada da Bry).
   */
  async signWithIntegraBry(req: {
    doctorId: string;
    sessionId: string;
    pdfBuffer: Uint8Array;
    contentDescription?: string;
    filename?: string;
  }): Promise<{ signedPdfUrl: string; signaturePath: string; signatureTimestamp: string | null }> {
    const session = await CredentialRepository.getLinkedPscSession({
      sessionId: req.sessionId,
      doctorId: req.doctorId,
    });
    if (!session) {
      throw SignatureErrors.NotConfigured(
        "Sessão Integra Bry não encontrada, expirada ou ainda não linkada.",
      );
    }
    const { IntegraBryApi } = await import("@/lib/bry/integraBry.server");
    const signed = await IntegraBryApi.signPdf({
      apiKey: session.apiKey,
      pdfBuffer: req.pdfBuffer,
      filename: req.filename ?? `documento_${Date.now()}.pdf`,
      reason: req.contentDescription ?? "Assinatura ICP-Brasil",
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
    if (cert) {
      const provider = await CertificateProviderFactory.get(cert as StoredCertificate);
      const info = provider.getCertificateInformation(cert as StoredCertificate);
      // Never expose secrets / raw material to the frontend.
      const safe = { ...(cert as Record<string, unknown>) };
      delete safe.code_verifier_encrypted;
      delete safe.raw_metadata;
      return { ...safe, expired: info.expired, info };
    }

    // Sem certificado "tradicional" — verifica se há uma sessão Integra Bry
    // (A3 externo / certificado de outro PSC) ainda válida.
    const psc = await CredentialRepository.getActivePscLinkSession(doctorId);
    if (!psc) return null;
    return {
      provider: "integra_bry",
      provider_name: `Integra Bry (${psc.pscName})`,
      certificate_subject: psc.certificateSubject,
      credential_id: psc.id,
      pscSessionId: psc.id,
      expired: false,
      info: {
        provider: "integra_bry",
        subject: psc.certificateSubject,
        holderDocument: psc.holderDocument,
        validUntil: psc.validUntil,
        expiresAt: psc.expiresAt,
      },
    };
  },

  async removeCredential(doctorId: string) {
    const cert = await CredentialRepository.getActiveCertificate(doctorId);
    if (cert) {
      const provider = await CertificateProviderFactory.get(cert as StoredCertificate);
      await provider.revokeAuthentication(cert as StoredCertificate);
      return { removed: true };
    }
    const psc = await CredentialRepository.getActivePscLinkSession(doctorId);
    if (psc) {
      await CredentialRepository.expirePscLinkSession(psc.id, doctorId);
      return { removed: true };
    }
    return { removed: false };
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
    if (!cert) {
      const psc = await CredentialRepository.getActivePscLinkSession(req.doctorId);
      if (psc) {
        return this.signWithIntegraBry({
          doctorId: req.doctorId,
          sessionId: psc.id,
          pdfBuffer: req.pdfBuffer,
          contentDescription: req.contentDescription,
          filename: req.filename,
        });
      }
      throw SignatureErrors.CredentialExpired("Nenhum certificado ativo.");
    }
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
