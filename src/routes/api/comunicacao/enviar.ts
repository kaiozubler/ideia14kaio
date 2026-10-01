import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Envia mensagem da CLÍNICA para o PACIENTE pelo WhatsApp da própria clínica.
 *
 * Body:
 *   destino:  conversa_id | paciente_id | telefone
 *   tipo:     "texto" | "modelo" | "documento"
 *   texto:            (tipo texto)
 *   modelo_id, valores: (tipo modelo — valores das variáveis; o que faltar é
 *                       preenchido pelo mapeamento salvo no modelo)
 *   arquivo: { base64, mime, nome }  (documento livre ou cabeçalho de mídia)
 *   documento_id:     envia um PDF de documentos_paciente (receita, atestado...)
 *                     direto do storage — dispensa "arquivo" e já marca o
 *                     documento como enviado
 *   agendamento_id:   contexto para variáveis de consulta (data, hora...)
 */

const MAX_ARQUIVO_BYTES = 15 * 1024 * 1024;

function base64ParaBytes(b64: string): Uint8Array {
  const limpo = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(limpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const Route = createFileRoute("/api/comunicacao/enviar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { enviarParaPaciente, respostaDeErro } =
          await import("@/lib/comunicacao/envio.server");
        const db = supabaseAdmin as any;

        try {
          let arquivo: { bytes: Uint8Array; mime: string; nome: string } | null = null;
          let pacienteId: string | null = body.paciente_id || null;
          let tipo = body.tipo;

          if (body.documento_id) {
            const { data: doc } = await db
              .from("documentos_paciente")
              .select("id,paciente_id,paciente_nome,arquivo_path,arquivo_nome,tipo")
              .eq("id", body.documento_id)
              .eq("id_medico", userId)
              .maybeSingle();
            if (!doc)
              return Response.json(
                { error: "documento_inexistente", message: "Documento não encontrado." },
                { status: 404 },
              );
            if (!doc.arquivo_path) {
              return Response.json(
                { error: "sem_arquivo", message: "Este documento não tem PDF salvo para enviar." },
                { status: 400 },
              );
            }
            const { data: blob, error } = await db.storage
              .from("documentos-arquivos")
              .download(doc.arquivo_path);
            if (error || !blob) throw new Error("Não foi possível ler o PDF do documento.");
            arquivo = {
              bytes: new Uint8Array(await blob.arrayBuffer()),
              mime: "application/pdf",
              nome: doc.arquivo_nome || `${doc.tipo || "documento"}.pdf`,
            };
            pacienteId = pacienteId || doc.paciente_id;
            if (!tipo || tipo === "documento") tipo = "documento";
            if (!pacienteId && !body.conversa_id && !body.telefone) {
              return Response.json(
                {
                  error: "sem_destino",
                  message:
                    "Documento sem paciente vinculado: abra a conversa do paciente e anexe por lá.",
                },
                { status: 400 },
              );
            }
          } else if (body.arquivo?.base64) {
            const bytes = base64ParaBytes(String(body.arquivo.base64));
            if (bytes.byteLength > MAX_ARQUIVO_BYTES) {
              return Response.json(
                { error: "arquivo_grande", message: "Arquivo acima de 15MB." },
                { status: 400 },
              );
            }
            arquivo = {
              bytes,
              mime: String(body.arquivo.mime || "application/octet-stream"),
              nome: String(body.arquivo.nome || "arquivo").slice(0, 200),
            };
          }

          if (!["texto", "modelo", "documento"].includes(tipo)) {
            return Response.json(
              { error: "tipo_invalido", message: "Tipo de envio inválido." },
              { status: 400 },
            );
          }

          const r = await enviarParaPaciente(db, {
            idMedico: userId,
            usuarioId: userId,
            destino: {
              conversaId: body.conversa_id || null,
              pacienteId,
              telefone: body.telefone || null,
            },
            tipo,
            texto: body.texto,
            modeloId: body.modelo_id || null,
            valores: body.valores && typeof body.valores === "object" ? body.valores : {},
            arquivo,
            legenda: body.legenda || null,
            documentoId: body.documento_id || null,
            agendamentoId: body.agendamento_id || null,
          });
          return Response.json({
            ok: true,
            mensagem: r.mensagem,
            conversa_id: r.conversa.id,
            usou_modelo: r.usouModelo,
          });
        } catch (e) {
          return respostaDeErro(e);
        }
      },
    },
  },
});
