// Busca nome/CRM do médico (para o cabeçalho do PDF) e faz o upload do arquivo
// gerado para o bucket já usado pelo resto do app ("documentos-arquivos"),
// atualizando o registro em documentos_paciente com o caminho salvo.
import type { DoctorInfo } from "./pdfBuilder.server";

type Db = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const BUCKET = "documentos-arquivos";

export async function getDoctorInfo(db: Db, medicoId: string | null): Promise<DoctorInfo> {
  if (!medicoId) return { name: "Médico responsável" };
  try {
    const { data, error } = await db.auth.admin.getUserById(medicoId);
    if (error || !data?.user) return { name: "Médico responsável" };
    const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
    const name =
      (meta.full_name as string) || (meta.name as string) || data.user.email?.split("@")[0] || "Médico responsável";
    const crm = (meta.crm as string) || (meta.CRM as string) || null;
    return { name, crm };
  } catch {
    return { name: "Médico responsável" };
  }
}

// Não lança em caso de falha: um documento sem PDF anexado ainda é útil (fica
// visível no histórico), então um erro aqui não deve derrubar a resposta do
// assistente — só faz o card ficar sem botão de abrir o arquivo.
export async function attachPdfToDocumento(
  db: Db,
  params: { medicoId: string; documentoId: string; bytes: Uint8Array; filename: string },
): Promise<{ arquivo_path: string; arquivo_nome: string } | null> {
  try {
    const path = `${params.medicoId}/${params.documentoId}.pdf`;
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(path, params.bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("[attachPdfToDocumento] upload falhou:", upErr.message);
      return null;
    }
    const { error: dbErr } = await db
      .from("documentos_paciente")
      .update({ arquivo_path: path, arquivo_nome: params.filename })
      .eq("id", params.documentoId);
    if (dbErr) {
      console.error("[attachPdfToDocumento] update falhou:", dbErr.message);
      return null;
    }
    return { arquivo_path: path, arquivo_nome: params.filename };
  } catch (e) {
    console.error("[attachPdfToDocumento] erro inesperado:", e);
    return null;
  }
}
