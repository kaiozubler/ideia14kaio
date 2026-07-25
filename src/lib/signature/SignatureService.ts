// Facade used by server routes / server functions.
// Screens must NEVER import provider or repository directly — only this service.
import { CredentialRepository } from "./CredentialRepository";
import { IntegraICPProvider } from "./IntegraICPProvider";
import { generatePKCE } from "./PKCEService";
import { SignatureErrors } from "./errors";
import type {
  AuthenticateInput,
  AuthenticateResult,
  SignatureProvider,
} from "./types";

// Swap here to plug in a different provider in the future.
const provider: SignatureProvider = IntegraICPProvider;

export const SignatureService = {
  async authenticate(input: AuthenticateInput): Promise<AuthenticateResult> {
    if (!input.cpf) throw SignatureErrors.InvalidPKCE("CPF requerido.");
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const sessionId = await CredentialRepository.createPkceSession({
      doctorId: input.doctorId,
      codeVerifier,
    });

    // Append session id so the callback can find the PKCE row.
    const cb = new URL(input.callbackUrl);
    cb.searchParams.set("session", sessionId);

    const { requestId, clearances } = await provider.authenticate({
      cpf: input.cpf,
      codeChallenge,
      callbackUrl: cb.toString(),
    });

    if (requestId) await CredentialRepository.attachRequestId(sessionId, requestId);

    const redirectUrl =
      clearances.length === 1 ? clearances[0].authorizationUrl || null : null;

    return { requestId, sessionId, clearances, redirectUrl };
  },

  async handleCallback(params: { credentialId: string; sessionId?: string; requestId?: string }) {
    const { doctorId, codeVerifier } = await CredentialRepository.consumeVerifier({
      sessionId: params.sessionId,
      requestId: params.requestId,
    });
    const cred = await provider.fetchCredential({
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
    const expired =
      cert.credential_expires_at &&
      new Date(cert.credential_expires_at).getTime() < Date.now();
    return { ...cert, expired };
  },

  async signDocument(req: {
    doctorId: string;
    documentId: string;
    pdfBuffer: Uint8Array;
    contentDescription?: string;
    filename?: string;
  }): Promise<{ signedPdfUrl: string; signaturePath: string; signatureTimestamp: string | null }> {
    const active = await CredentialRepository.getActiveCertificateWithVerifier(req.doctorId);
    if (!active) throw SignatureErrors.CredentialExpired("Nenhum certificado ativo.");
    const { cert, codeVerifier } = active;
    if (
      cert.credential_expires_at &&
      new Date(cert.credential_expires_at).getTime() < Date.now()
    ) {
      throw SignatureErrors.CredentialExpired();
    }
    if (!codeVerifier) {
      throw SignatureErrors.InvalidPKCE(
        "Verificador PKCE ausente para este certificado. Reconecte o certificado.",
      );
    }

    const { embedCMSIntoPDF } = await import("./PadesEmbedder.server");
    const signed = await embedCMSIntoPDF({
      pdfBuffer: req.pdfBuffer,
      reason: req.contentDescription ?? "Assinatura ICP-Brasil",
      name: cert.certificate_subject ?? "Médico",
      signer: async (digestBase64) => {
        const result = await provider.sign({
          credentialId: cert.credential_id,
          codeVerifier,
          documentId: req.documentId,
          contentDigest: digestBase64,
          contentDescription: req.contentDescription ?? "Receita",
        });
        return result.signedContent; // base64 CMS
      },
    });

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
  },
};