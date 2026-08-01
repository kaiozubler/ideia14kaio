// Server-only persistence for BRY signature envelopes.
import type { BryStatus } from "./bry.server";

const BUCKET = "bry-signed-documents";

export interface AssinaturaRow {
  id: string;
  user_id: string;
  consulta_id: string | null;
  documento_id: string | null;
  paciente_nome: string | null;
  paciente_email: string | null;
  tipo_documento: string;
  bry_envelope_id: string | null;
  status: string;
  sign_url: string | null;
  download_url: string | null;
  arquivo_assinado: string | null;
  erro: string | null;
  created_at: string;
  updated_at: string;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const BryRepository = {
  async create(input: {
    userId: string;
    consultaId?: string | null;
    documentoId?: string | null;
    pacienteNome?: string | null;
    pacienteEmail?: string | null;
    tipoDocumento: string;
    envelopeId: string;
    status: BryStatus;
    signUrl: string | null;
    downloadUrl: string | null;
  }): Promise<AssinaturaRow> {
    const db = await admin();
    const { data, error } = await db
      .from("assinaturas_digitais")
      .insert({
        user_id: input.userId,
        consulta_id: input.consultaId ?? null,
        documento_id: input.documentoId ?? null,
        paciente_nome: input.pacienteNome ?? null,
        paciente_email: input.pacienteEmail ?? null,
        tipo_documento: input.tipoDocumento,
        bry_envelope_id: input.envelopeId,
        status: input.status,
        sign_url: input.signUrl,
        download_url: input.downloadUrl,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as AssinaturaRow;
  },

  async getById(id: string, userId?: string): Promise<AssinaturaRow | null> {
    const db = await admin();
    let q = db.from("assinaturas_digitais").select("*").eq("id", id);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return (data as AssinaturaRow | null) ?? null;
  },

  async getByEnvelopeId(envelopeId: string): Promise<AssinaturaRow | null> {
    const db = await admin();
    const { data, error } = await db
      .from("assinaturas_digitais")
      .select("*")
      .eq("bry_envelope_id", envelopeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as AssinaturaRow | null) ?? null;
  },

  async update(id: string, patch: Partial<AssinaturaRow>): Promise<AssinaturaRow> {
    const db = await admin();
    const { data, error } = await db
      .from("assinaturas_digitais")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data as AssinaturaRow;
  },

  async uploadSignedPdf(input: {
    userId: string;
    envelopeId: string;
    filename: string;
    bytes: Uint8Array;
  }): Promise<{ path: string; signedUrl: string }> {
    const db = await admin();
    const safe = input.filename.replace(/[^\w.\-]+/g, "_");
    const path = `${input.userId}/${input.envelopeId}_${Date.now()}_${safe}`;
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(path, input.bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw upErr;
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error) throw error;
    return { path, signedUrl: data.signedUrl };
  },

  async createSignedUrl(path: string): Promise<string | null> {
    const db = await admin();
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data.signedUrl;
  },
};