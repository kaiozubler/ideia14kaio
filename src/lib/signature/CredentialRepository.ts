// Repository for doctor certificates + PKCE sessions.
// Uses the service-role client — MUST run only in server routes/functions.
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
  async createPkceSession(params: {
    doctorId: string;
    codeVerifier: string;
  }): Promise<string> {
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

    await sb
      .from("signature_pkce_sessions")
      .update({ status: "consumed" })
      .eq("id", data.id);

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

  async upsertCertificate(doctorId: string, cred: CredentialData) {
    const sb = await admin();
    const { error } = await sb
      .from("doctor_certificates")
      .upsert(
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
};