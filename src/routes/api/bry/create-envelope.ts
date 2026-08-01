import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  consulta_id: z.string().uuid().nullable().optional(),
  documento_id: z.string().uuid().nullable().optional(),
  documento_pdf_base64: z.string().min(100),
  nome_paciente: z.string().min(1).max(200),
  email_paciente: z.string().email(),
  tipo_documento: z.string().min(1).max(60),
  filename: z.string().max(160).optional(),
});

export const Route = createFileRoute("/api/bry/create-envelope")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserIdFromRequest, bryErrorResponse } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid_body", details: parsed.error.issues },
            { status: 400 },
          );
        }
        const body = parsed.data;
        const b64 = body.documento_pdf_base64.includes(",")
          ? body.documento_pdf_base64.slice(body.documento_pdf_base64.indexOf(",") + 1)
          : body.documento_pdf_base64;

        try {
          const { BryApi } = await import("@/lib/bry/bry.server");
          const { BryRepository } = await import("@/lib/bry/repository.server");
          const origin = new URL(request.url).origin;

          const envelope = await BryApi.createEnvelope({
            documentoPdfBase64: b64,
            nomePaciente: body.nome_paciente,
            emailPaciente: body.email_paciente,
            tipoDocumento: body.tipo_documento,
            filename: body.filename,
            callbackUrl: `${origin}/api/public/webhooks/bry`,
          });

          const row = await BryRepository.create({
            userId,
            consultaId: body.consulta_id ?? null,
            documentoId: body.documento_id ?? null,
            pacienteNome: body.nome_paciente,
            pacienteEmail: body.email_paciente,
            tipoDocumento: body.tipo_documento,
            envelopeId: envelope.envelopeId,
            status: envelope.status,
            signUrl: envelope.signUrl,
            downloadUrl: envelope.downloadUrl,
          });

          return Response.json({
            ok: true,
            id: row.id,
            bry_envelope_id: envelope.envelopeId,
            sign_url: envelope.signUrl,
            status: row.status,
          });
        } catch (err) {
          return bryErrorResponse("create-envelope", err);
        }
      },
    },
  },
});