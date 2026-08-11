// Server-only audit trail for digital signature attempts (success + failure).
// NEVER pass secrets here (password, PIN, private key, PFX bytes, raw tokens) —
// only IDs, hashes and provider-safe metadata. See seção 13 do comando de
// implementação da assinatura digital.
//
// Runtime roda em Cloudflare Workers — usa Web Crypto (crypto.subtle), nunca
// node:crypto. Reaproveita o helper que a própria assinatura já usa.
export { sha256Hex } from "./DigestService";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface AuditLogInput {
  userId: string;
  documentId?: string | null;
  certificateId?: string | null;
  certificateType?: string | null;
  provider?: string | null;
  documentHash?: string | null;
  signatureStatus: "success" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
  signedDocumentPath?: string | null;
}

export const AuditRepository = {
  /** Best-effort: a falha ao gravar auditoria nunca deve derrubar a assinatura em si. */
  async log(input: AuditLogInput): Promise<void> {
    try {
      const sb = await admin();
      // NOTA: "signature_audit_log" e "last_used_at"/"status" (abaixo) são novos
      // (ver migration 20260811190000_signature_audit_log.sql). Os tipos gerados
      // do Supabase (types.ts) só incluem essas colunas depois que a migration
      // rodar no projeto e `supabase gen types` for reexecutado — por isso o
      // cast `as never`, no mesmo padrão já usado em CredentialRepository para
      // colunas recém-adicionadas.
      const { error } = await sb.from("signature_audit_log" as never).insert({
        user_id: input.userId,
        document_id: input.documentId ?? null,
        certificate_id: input.certificateId ?? null,
        certificate_type: input.certificateType ?? null,
        provider: input.provider ?? null,
        document_hash: input.documentHash ?? null,
        signature_status: input.signatureStatus,
        error_code: input.errorCode ?? null,
        // Mensagens amigáveis apenas — nunca corpo bruto de resposta da BRy com dados sensíveis.
        error_message: input.errorMessage ? String(input.errorMessage).slice(0, 500) : null,
        signed_document_path: input.signedDocumentPath ?? null,
      } as never);
      if (error) console.error("[signature:audit] falha ao gravar auditoria", error);
    } catch (e) {
      console.error("[signature:audit] falha ao gravar auditoria", e);
    }
  },

  async touchLastUsed(certificateId: string): Promise<void> {
    try {
      const sb = await admin();
      await sb
        .from("doctor_certificates")
        .update({ last_used_at: new Date().toISOString() } as never)
        .eq("id", certificateId);
    } catch (e) {
      console.error("[signature:audit] falha ao atualizar last_used_at", e);
    }
  },
};
