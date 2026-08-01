// Client-side service: talks only to our own server routes, never to BRY.
import { supabase } from "@/integrations/supabase/client";

export type BrySignatureStatus = "PENDING" | "SIGNED" | "EXPIRED" | "CANCELLED" | "REJECTED";

export interface BrySignature {
  id: string;
  consulta_id: string | null;
  documento_id: string | null;
  paciente_nome: string | null;
  paciente_email: string | null;
  tipo_documento: string;
  bry_envelope_id: string | null;
  status: BrySignatureStatus;
  sign_url: string | null;
  download_url: string | null;
  arquivo_assinado: string | null;
  erro: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEnvelopeParams {
  consultaId?: string | null;
  documentoId?: string | null;
  pdfBase64: string;
  nomePaciente: string;
  emailPaciente: string;
  tipoDocumento: string;
  filename?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-json response */
  }
  if (!res.ok) {
    const message =
      (json.message as string) || (json.error as string) || `Erro ${res.status} na assinatura`;
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = json.error as string | undefined;
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export const bryService = {
  async createEnvelope(params: CreateEnvelopeParams) {
    const res = await fetch("/api/bry/create-envelope", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        consulta_id: params.consultaId ?? null,
        documento_id: params.documentoId ?? null,
        documento_pdf_base64: params.pdfBase64,
        nome_paciente: params.nomePaciente,
        email_paciente: params.emailPaciente,
        tipo_documento: params.tipoDocumento,
        ...(params.filename ? { filename: params.filename } : {}),
      }),
    });
    return handle<{
      ok: true;
      id: string;
      bry_envelope_id: string;
      sign_url: string | null;
      status: BrySignatureStatus;
    }>(res);
  },

  async getEnvelope(id: string) {
    const res = await fetch(`/api/bry/get-envelope?id=${encodeURIComponent(id)}`, {
      headers: await authHeaders(),
    });
    return handle<{ ok: true; signature: BrySignature }>(res);
  },

  async downloadDocument(id: string) {
    const res = await fetch("/api/bry/download-document", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ id }),
    });
    return handle<{ ok: true; signature: BrySignature; file_url: string | null }>(res);
  },

  async cancelEnvelope(id: string) {
    const res = await fetch("/api/bry/cancel-envelope", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ id }),
    });
    return handle<{ ok: true; signature: BrySignature }>(res);
  },
};