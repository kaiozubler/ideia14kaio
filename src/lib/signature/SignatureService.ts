// Facade used by server routes / server functions.
// Screens must NEVER import provider or repository directly — only this service.
import { CredentialRepository } from "./CredentialRepository";
import { IntegraICPProvider } from "./IntegraICPProvider";
import { generatePKCE } from "./PKCEService";
import { sha256Base64 } from "./DigestService";
import { SignatureErrors } from "./errors";
import type {
  AuthenticateInput,
  AuthenticateResult,
  SignRequest,
  SignResult,
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
    await CredentialRepository.upsertCertificate(doctorId, cred);
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

  async signDocument(req: SignRequest): Promise<SignResult> {
    const cert = await CredentialRepository.getActiveCertificate(req.doctorId);
    if (!cert) throw SignatureErrors.CredentialExpired("Nenhum certificado ativo.");
    if (
      cert.credential_expires_at &&
      new Date(cert.credential_expires_at).getTime() < Date.now()
    ) {
      throw SignatureErrors.CredentialExpired();
    }
    // Phase 2 will store the verifier durably; for now signing requires an
    // active PKCE session (not yet consumed). Signing flow is out of scope
    // for phase 1 and will be wired end-to-end in phase 2.
    throw SignatureErrors.NotConfigured("Assinatura será liberada na Fase 2.");
  },
};