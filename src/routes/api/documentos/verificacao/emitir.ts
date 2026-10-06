import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import {
  admin,
  BUCKET_VERIFICACAO,
  extrairAssinatura,
  sha256Hex,
} from "@/lib/documentos/verificacao.server";

// Recebe o PDF FINAL (assinado ou não) de um registro reservado. O servidor
// guarda a própria cópia, calcula o hash e lê a assinatura do próprio PDF —
// nada sobre a assinatura é aceito do navegador.
const BodySchema = z.object({ id: z.string().uuid(), pdfBase64: z.string().min(100) });
const LIMITE_BYTES = 15 * 1024 * 1024;

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const Route = createFileRoute("/api/documentos/verificacao/emitir")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

        let pdf: Uint8Array;
        try {
          pdf = b64ToBytes(parsed.data.pdfBase64);
        } catch {
          return Response.json({ error: "invalid_pdf" }, { status: 400 });
        }
        if (pdf.length > LIMITE_BYTES)
          return Response.json({ error: "pdf_too_large" }, { status: 413 });
        if (String.fromCharCode(...pdf.subarray(0, 5)) !== "%PDF-") {
          return Response.json({ error: "invalid_pdf" }, { status: 400 });
        }

        try {
          const sb = await admin();
          const { data: reg, error } = await sb
            .from("documentos_verificacao")
            .select("id, id_medico, status")
            .eq("id", parsed.data.id)
            .maybeSingle();
          if (error) throw error;
          if (!reg || reg.id_medico !== userId)
            return Response.json({ error: "not_found" }, { status: 404 });
          if (reg.status !== "reservado")
            return Response.json({ error: "already_issued" }, { status: 409 });

          const path = `${userId}/${reg.id}.pdf`;
          const { error: upErr } = await sb.storage
            .from(BUCKET_VERIFICACAO)
            .upload(path, pdf, { contentType: "application/pdf", upsert: true });
          if (upErr) throw upErr;

          const [hash, assinatura] = await Promise.all([sha256Hex(pdf), extrairAssinatura(pdf)]);
          const { error: updErr } = await sb
            .from("documentos_verificacao")
            .update({
              status: "emitido",
              arquivo_path: path,
              arquivo_sha256: hash,
              arquivo_bytes: pdf.length,
              assinatura,
              emitido_em: new Date().toISOString(),
            })
            .eq("id", reg.id)
            .eq("status", "reservado");
          if (updErr) throw updErr;

          return Response.json({ ok: true, sha256: hash, assinado: assinatura.assinado });
        } catch (e) {
          console.error("[documentos/verificacao/emitir]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
