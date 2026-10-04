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

/** Limites aceitos pelo Integra Bry para `lifetime` em /psc/link. */
const PSC_MIN_LIFETIME_SECONDS = 180;
const PSC_MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const PSC_DEFAULT_LIFETIME_SECONDS = 12 * 60 * 60;

type ActivePscSession = NonNullable<
  Awaited<ReturnType<typeof CredentialRepository.getActivePscLinkSession>>
>;

/**
 * Decide qual credencial assina: a linha de doctor_certificates ou o vínculo
 * Integra Bry. O vínculo vence quando é mais recente que o certificado ou
 * quando o certificado venceu — é o que o médico acabou de conectar ao ser
 * cobrado na hora de assinar, e sem isso um certificado antigo bloquearia
 * para sempre o A3 externo.
 */
async function resolveActiveCredential(
  doctorId: string,
): Promise<
  { kind: "certificate"; cert: StoredCertificate } | { kind: "psc"; psc: ActivePscSession } | null
> {
  const [cert, psc] = await Promise.all([
    CredentialRepository.getActiveCertificate(doctorId),
    CredentialRepository.getActivePscLinkSession(doctorId),
  ]);
  if (cert && psc) {
    const provider = await CertificateProviderFactory.get(cert as StoredCertificate);
    const expired = provider.getCertificateInformation(cert as StoredCertificate).expired;
    const row = cert as { updated_at?: string | null; created_at?: string | null };
    const certTime = Date.parse(row.updated_at ?? row.created_at ?? "") || 0;
    if (expired || Date.parse(psc.createdAt) > certTime) return { kind: "psc", psc };
  }
  if (cert) return { kind: "certificate", cert: cert as StoredCertificate };
  if (psc) return { kind: "psc", psc };
  return null;
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

  /** Lista os PSCs suportados pelo Integra Bry, para o médico escolher qual usar. */
  async listIntegraBryPscs() {
    const { IntegraBryApi } = await import("@/lib/bry/integraBry.server");
    return IntegraBryApi.listPscs();
  },

  /**
   * A3 externo (certificado hospedado por outro PSC, não pela BRy) via
   * Integra Bry. Gera o link de autenticação com o PSC escolhido — o
   * médico abre esse link, autentica no PSC e escolhe o certificado.
   * `lifetimeSeconds` é o prazo de vigência escolhido pelo médico
   * (180 a 604800s; default 12h).
   */
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
    const requested = Math.round(Number(req.lifetimeSeconds) || PSC_DEFAULT_LIFETIME_SECONDS);
    const lifetimeSeconds = Math.min(
      PSC_MAX_LIFETIME_SECONDS,
      Math.max(PSC_MIN_LIFETIME_SECONDS, requested),
    );
    const link = await IntegraBryApi.createLink({
      pscName: req.pscName,
      redirectUri: req.redirectUri,
      state,
      // "signature_session" mantém o vínculo reutilizável durante todo o
      // prazo escolhido pelo médico (e é o exigido pelo Vidaas acima de 20
      // documentos). Para assinar um único documento sem manter vínculo, o
      // chamador pode passar scope: "single_signature".
      scope: req.scope ?? "signature_session",
      lifetime: lifetimeSeconds,
      cpf: req.cpf,
    });
    const sessionId = await CredentialRepository.createPscLinkSession({
      doctorId: req.doctorId,
      pscName: req.pscName,
      state,
      redirectUri: req.redirectUri,
      apiKey: link.apiKey,
      expiresAt: new Date(Date.now() + lifetimeSeconds * 1000).toISOString(),
    });
    return { sessionId, authorizationUrl: link.authorizationUrl, state };
  },

  /**
   * Chamado quando o PSC redireciona de volta (?state=...) após o médico
   * autenticar e escolher o certificado. Confirma a sessão e devolve os
   * dados do certificado escolhido (via /auth/info + /auth/certificate).
   */
  async completeIntegraBryLink(params: { doctorId: string; state: string }) {
    const session = await CredentialRepository.getPscLinkSessionByState(params.state);
    if (!session) throw SignatureErrors.NotConfigured("Sessão de link Integra Bry não encontrada.");
    if (session.doctorId !== params.doctorId) {
      throw SignatureErrors.Unauthorized("Esta sessão de certificado pertence a outro usuário.");
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      throw SignatureErrors.Timeout("Sessão de link Integra Bry expirada. Inicie novamente.");
    }
    // O Integra Bry devolve esta credencial como `token` em /psc/link. O
    // `state` identifica somente a nossa sessão e nunca pode ser usado como
    // X-API-KEY nas consultas ao provedor.
    const apiKey = session.apiKey;
    if (!apiKey) {
      throw SignatureErrors.NotConfigured(
        "A sessão foi criada sem a credencial do Integra Bry. Inicie um novo vínculo.",
      );
    }
    const { IntegraBryApi } = await import("@/lib/bry/integraBry.server");
    const info = await IntegraBryApi.getAuthInfo(apiKey);
    const status = (info.status ?? "").toLowerCase();
    if (/pend|wait|aguard|^created$/.test(status)) {
      // Médico ainda não concluiu no PSC: o callback responde 202 e o
      // frontend continua aguardando.
      const { BryError } = await import("@/lib/bry/bry.server");
      throw new BryError("Autorização pendente no PSC.", 400, { error: "authorization_pending" });
    }
    if (/denied|negad|reject|recus|cancel|expired|revog|fail|error|erro/.test(status)) {
      throw SignatureErrors.UserCancelled(
        `A certificadora não autorizou o vínculo (status: ${info.status}). Tente novamente.`,
      );
    }
    const certificate = await IntegraBryApi.getAuthCertificate(apiKey);
    // Se o PSC autorizou por menos tempo do que o pedido (no Vidaas o
    // médico escolhe o prazo no app), o vínculo local acompanha o prazo real.
    const pscExpiry = info.expiresAt ? Date.parse(info.expiresAt) : NaN;
    const expiresAt =
      Number.isFinite(pscExpiry) && pscExpiry < Date.parse(session.expiresAt)
        ? new Date(pscExpiry).toISOString()
        : null;
    await CredentialRepository.markPscLinkSessionLinked(
      session.id,
      apiKey,
      {
        subject: certificate.subject,
        holderDocument: certificate.holderDocument,
        validUntil: certificate.validUntil,
      },
      expiresAt,
    );
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
    let signed: SignedDocument;
    try {
      signed = await IntegraBryApi.signPdf({
        apiKey: session.apiKey,
        pdfBuffer: req.pdfBuffer,
        filename: req.filename ?? `documento_${Date.now()}.pdf`,
        reason: req.contentDescription ?? "Assinatura ICP-Brasil",
      });
    } catch (err) {
      // Autorização encerrada antes do prazo local (revogada no app do PSC
      // ou prazo menor escolhido lá): encerra o vínculo e devolve
      // credential_expired para a tela oferecer reconectar na hora.
      const e = err as { name?: string; status?: number; message?: string };
      const revoked =
        e?.name === "BryError" &&
        (e.status === 401 ||
          e.status === 403 ||
          /expir|revog|token.*inv[aá]lid|inv[aá]lid.*token|n[aã]o autoriz/i.test(e.message ?? ""));
      if (!revoked) throw err;
      await CredentialRepository.expirePscLinkSession(req.sessionId, req.doctorId);
      throw SignatureErrors.CredentialExpired(
        `A autorização do certificado em ${session.pscName} expirou ou foi revogada. Conecte novamente para assinar.`,
      );
    }
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
    const active = await resolveActiveCredential(doctorId);
    if (active?.kind === "certificate") {
      const cert = active.cert;
      const provider = await CertificateProviderFactory.get(cert as StoredCertificate);
      const info = provider.getCertificateInformation(cert as StoredCertificate);
      // Never expose secrets / raw material to the frontend.
      const safe = { ...(cert as Record<string, unknown>) };
      delete safe.code_verifier_encrypted;
      delete safe.raw_metadata;
      return { ...safe, expired: info.expired, info };
    }

    // Vínculo Integra Bry (A3 externo / certificado de outro PSC) ativo.
    if (!active) return null;
    const psc = active.psc;
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
    const active = await resolveActiveCredential(doctorId);
    if (active?.kind === "certificate") {
      const provider = await CertificateProviderFactory.get(active.cert);
      await provider.revokeAuthentication(active.cert);
      return { removed: true };
    }
    if (active?.kind === "psc") {
      await CredentialRepository.expirePscLinkSession(active.psc.id, doctorId);
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
    const active = await resolveActiveCredential(req.doctorId);
    if (active?.kind === "psc") {
      return this.signWithIntegraBry({
        doctorId: req.doctorId,
        sessionId: active.psc.id,
        pdfBuffer: req.pdfBuffer,
        contentDescription: req.contentDescription,
        filename: req.filename,
      });
    }
    if (!active) {
      const latestPsc = await CredentialRepository.getLatestPscLinkSession(req.doctorId);
      if (latestPsc?.status === "linked" && new Date(latestPsc.expiresAt).getTime() <= Date.now()) {
        throw SignatureErrors.CredentialExpired(
          "O prazo de vínculo do seu certificado digital terminou. Conecte novamente para assinar.",
        );
      }
      throw SignatureErrors.CredentialExpired("Nenhum certificado digital ativo.");
    }
    const cert = active.cert;
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
