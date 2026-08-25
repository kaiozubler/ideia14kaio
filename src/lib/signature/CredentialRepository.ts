// Repository for doctor certificates + PKCE sessions.
// Uses the service-role client — MUST run only in server routes/functions.
import { Buffer } from "node:buffer";
import { encryptVerifier, decryptVerifier } from "./PKCEService";
import { SignatureErrors } from "./errors";
import type { CredentialData } from "./types";

function requireEncryptionKey(): string {
  const key = process.env.SIGNATURE_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw SignatureErrors.NotConfigured(
      "SIGNATURE_ENCRYPTION_KEY não configurado (mínimo 16 caracteres).",
    );
  }
  return key;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const CredentialRepository = {
  async createPkceSession(params: { doctorId: string; codeVerifier: string }): Promise<string> {
    const enc = await encryptVerifier(params.codeVerifier, requireEncryptionKey());
    const sb = await admin();
    const { data, error } = await sb
      .from("signature_pkce_sessions")
      .insert({
        doctor_id: params.doctorId,
        code_verifier_encrypted: enc,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  },

  async attachRequestId(sessionId: string, requestId: string) {
    const sb = await admin();
    const { error } = await sb
      .from("signature_pkce_sessions")
      .update({ request_id: requestId })
      .eq("id", sessionId);
    if (error) throw error;
  },

  async consumeVerifier(params: {
    sessionId?: string;
    requestId?: string;
  }): Promise<{ doctorId: string; codeVerifier: string }> {
    const sb = await admin();
    let query = sb
      .from("signature_pkce_sessions")
      .select("id, doctor_id, code_verifier_encrypted, status, expires_at")
      .eq("status", "pending");
    if (params.sessionId) query = query.eq("id", params.sessionId);
    else if (params.requestId) query = query.eq("request_id", params.requestId);
    else throw SignatureErrors.InvalidPKCE("sessionId ou requestId requerido.");

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) throw SignatureErrors.InvalidPKCE("Sessão PKCE não encontrada.");
    if (new Date(data.expires_at).getTime() < Date.now()) {
      throw SignatureErrors.InvalidPKCE("Sessão PKCE expirada.");
    }

    const codeVerifier = await decryptVerifier(
      data.code_verifier_encrypted,
      requireEncryptionKey(),
    );

    await sb.from("signature_pkce_sessions").update({ status: "consumed" }).eq("id", data.id);

    return { doctorId: data.doctor_id, codeVerifier };
  },

  async peekVerifier(params: {
    sessionId?: string;
    requestId?: string;
  }): Promise<{ doctorId: string; codeVerifier: string }> {
    // Same as consume, but keeps the row usable for the signing step later.
    const sb = await admin();
    let query = sb
      .from("signature_pkce_sessions")
      .select("id, doctor_id, code_verifier_encrypted, expires_at");
    if (params.sessionId) query = query.eq("id", params.sessionId);
    else if (params.requestId) query = query.eq("request_id", params.requestId);
    else throw SignatureErrors.InvalidPKCE("sessionId ou requestId requerido.");
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) throw SignatureErrors.InvalidPKCE("Sessão PKCE não encontrada.");
    const codeVerifier = await decryptVerifier(
      data.code_verifier_encrypted,
      requireEncryptionKey(),
    );
    return { doctorId: data.doctor_id, codeVerifier };
  },

  async upsertCertificate(doctorId: string, cred: CredentialData, codeVerifier?: string) {
    const sb = await admin();
    const codeVerifierEncrypted = codeVerifier
      ? await encryptVerifier(codeVerifier, requireEncryptionKey())
      : undefined;
    const { error } = await sb.from("doctor_certificates").upsert(
      {
        doctor_id: doctorId,
        credential_id: cred.credentialId,
        provider_name: cred.providerName,
        product_name: cred.productName,
        certificate_subject: cred.certificateSubject,
        certificate_serial: cred.certificateSerial,
        certificate_fingerprint: cred.certificateFingerprint,
        certificate_valid_from: cred.certificateValidFrom,
        certificate_valid_until: cred.certificateValidUntil,
        credential_expires_at: cred.credentialExpiresAt,
        raw_metadata: cred.raw as never,
        ...(codeVerifierEncrypted ? { code_verifier_encrypted: codeVerifierEncrypted } : {}),
      },
      { onConflict: "doctor_id,credential_id" },
    );
    if (error) throw error;
  },

  async getActiveCertificate(doctorId: string) {
    const sb = await admin();
    const { data, error } = await sb
      .from("doctor_certificates")
      .select("*")
      .eq("doctor_id", doctorId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Persists a local (.pfx/.p12) certificate — path + metadata only, never the password. */
  async upsertLocalCertificate(params: {
    doctorId: string;
    credentialId: string;
    storagePath: string;
    label: string | null;
    subject: string | null;
    serial: string | null;
    fingerprint: string | null;
    issuer: string | null;
    holderDocument: string | null;
    validFrom: string | null;
    validUntil: string | null;
  }) {
    const sb = await admin();
    const { error } = await sb.from("doctor_certificates").upsert(
      {
        doctor_id: params.doctorId,
        credential_id: params.credentialId,
        provider: "local",
        certificate_type: "pfx",
        storage_path: params.storagePath,
        label: params.label,
        provider_name: "Certificado local",
        product_name: "A1 (.pfx/.p12)",
        certificate_subject: params.subject,
        certificate_serial: params.serial,
        certificate_fingerprint: params.fingerprint,
        issuer: params.issuer,
        holder_document: params.holderDocument,
        certificate_valid_from: params.validFrom,
        certificate_valid_until: params.validUntil,
        credential_expires_at: null,
        code_verifier_encrypted: null,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "doctor_id,credential_id" },
    );
    if (error) throw error;
  },

  async deleteCertificate(doctorId: string, id?: string) {
    const sb = await admin();
    let q = sb.from("doctor_certificates").delete().eq("doctor_id", doctorId);
    if (id) q = q.eq("id", id);
    const { error } = await q;
    if (error) throw error;
  },

  /**
   * Persists a BRy Cloud (BRyKMS) certificate reference — the PIN is NEVER
   * stored. `certificateSubtype` distingue A1 Bry de A3 Bry: o endpoint do
   * BRyKMS é o mesmo para os dois (a HSM resolve internamente), então essa
   * distinção é só metadado para exibição/regras de UI.
   */
  async upsertCloudCertificate(params: {
    doctorId: string;
    provider: string;
    credentialId: string;
    label: string | null;
    holderDocument: string | null;
    subject: string | null;
    providerName: string;
    productName: string;
    uuidCert?: string | null;
    certificateSubtype: "a1" | "a3";
  }) {
    const sb = await admin();
    const { error } = await sb.from("doctor_certificates").upsert(
      {
        doctor_id: params.doctorId,
        credential_id: params.credentialId,
        provider: params.provider,
        certificate_type: "cloud",
        certificate_subtype: params.certificateSubtype,
        storage_path: null,
        label: params.label,
        provider_name: params.providerName,
        product_name: params.productName,
        certificate_subject: params.subject,
        holder_document: params.holderDocument,
        certificate_serial: null,
        certificate_fingerprint: null,
        issuer: params.providerName,
        certificate_valid_from: null,
        certificate_valid_until: null,
        credential_expires_at: null,
        code_verifier_encrypted: null,
        raw_metadata: { uuid_cert: params.uuidCert ?? null } as never,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "doctor_id,credential_id" },
    );
    if (error) throw error;
  },

  /** Persists an A3 externo (token/smartcard local) reference — sem chave nenhuma no servidor. */
  async upsertA3ExternoCertificate(params: {
    doctorId: string;
    credentialId: string;
    label: string | null;
    holderDocument: string | null;
    subject: string | null;
  }) {
    const sb = await admin();
    const { error } = await sb.from("doctor_certificates").upsert(
      {
        doctor_id: params.doctorId,
        credential_id: params.credentialId,
        provider: "bry_a3_externo",
        certificate_type: "token",
        certificate_subtype: "a3_token",
        storage_path: null,
        label: params.label,
        provider_name: "A3 externo (token/smartcard)",
        product_name: "A3 ICP-Brasil local",
        certificate_subject: params.subject,
        holder_document: params.holderDocument,
        certificate_serial: null,
        certificate_fingerprint: null,
        issuer: null,
        certificate_valid_from: null,
        certificate_valid_until: null,
        credential_expires_at: null,
        code_verifier_encrypted: null,
        raw_metadata: null,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "doctor_id,credential_id" },
    );
    if (error) throw error;
  },

  /** Fase 1 do fluxo A3 externo: guarda o PDF-com-placeholder até a fase 2 chegar. */
  async createSignSession(params: {
    doctorId: string;
    documentId: string;
    digestBase64: string;
    placeholderPdf: Uint8Array;
    reason: string | null;
    signerName: string | null;
  }): Promise<string> {
    const sb = await admin();
    const { data, error } = await sb
      .from("signature_sign_sessions")
      .insert({
        doctor_id: params.doctorId,
        document_id: params.documentId,
        digest_base64: params.digestBase64,
        placeholder_pdf: `\\x${Buffer.from(params.placeholderPdf).toString("hex")}`,
        reason: params.reason,
        signer_name: params.signerName,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  },

  /** Fase 2: recupera e consome (marca como usada) a sessão criada na fase 1. */
  async consumeSignSession(params: {
    sessionId: string;
    doctorId: string;
  }): Promise<{ documentId: string; placeholderPdf: Uint8Array; reason: string | null } | null> {
    const sb = await admin();
    const { data, error } = await sb
      .from("signature_sign_sessions")
      .select("document_id, placeholder_pdf, reason, status, expires_at, doctor_id")
      .eq("id", params.sessionId)
      .eq("doctor_id", params.doctorId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as {
      document_id: string;
      placeholder_pdf: string;
      reason: string | null;
      status: string;
      expires_at: string;
    };
    if (row.status !== "pending" || new Date(row.expires_at).getTime() < Date.now()) return null;

    await sb
      .from("signature_sign_sessions")
      .update({ status: "consumed" } as never)
      .eq("id", params.sessionId);

    const hex = row.placeholder_pdf.startsWith("\\x")
      ? row.placeholder_pdf.slice(2)
      : row.placeholder_pdf;
    return {
      documentId: row.document_id,
      placeholderPdf: new Uint8Array(Buffer.from(hex, "hex")),
      reason: row.reason,
    };
  },

  async getActiveCertificateWithVerifier(doctorId: string) {
    const cert = await this.getActiveCertificate(doctorId);
    if (!cert) return null;
    const enc = (cert as unknown as { code_verifier_encrypted?: string | null })
      .code_verifier_encrypted;
    if (!enc) return { cert, codeVerifier: null as string | null };
    const codeVerifier = await decryptVerifier(enc, requireEncryptionKey());
    return { cert, codeVerifier };
  },
};
