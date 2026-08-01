import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ id: z.string().uuid() });

export const Route = createFileRoute("/api/bry/download-document")({
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
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

        try {
          const { BryRepository } = await import("@/lib/bry/repository.server");
          const { BryApi } = await import("@/lib/bry/bry.server");

          const row = await BryRepository.getById(parsed.data.id, userId);
          if (!row) return Response.json({ error: "not_found" }, { status: 404 });
          if (!row.bry_envelope_id) {
            return Response.json({ error: "envelope_missing" }, { status: 400 });
          }

          if (row.arquivo_assinado) {
            const url = await BryRepository.createSignedUrl(row.arquivo_assinado);
            return Response.json({ ok: true, signature: row, file_url: url });
          }

          if (row.status !== "SIGNED") {
            const remote = await BryApi.getEnvelope(row.bry_envelope_id);
            if (remote.status !== "SIGNED") {
              await BryRepository.update(row.id, { status: remote.status });
              return Response.json({ error: "not_signed", status: remote.status }, { status: 409 });
            }
            row.download_url = remote.downloadUrl ?? row.download_url;
            row.status = "SIGNED";
          }

          const bytes = await BryApi.downloadSignedPdf(row.bry_envelope_id, row.download_url);
          const uploaded = await BryRepository.uploadSignedPdf({
            userId,
            envelopeId: row.bry_envelope_id,
            filename: `${row.tipo_documento}_assinado.pdf`,
            bytes,
          });
          const updated = await BryRepository.update(row.id, {
            status: "SIGNED",
            arquivo_assinado: uploaded.path,
            erro: null,
          });

          return Response.json({ ok: true, signature: updated, file_url: uploaded.signedUrl });
        } catch (err) {
          return bryErrorResponse("download-document", err);
        }
      },
    },
  },
});