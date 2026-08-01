// Public webhook for BRY EasySign notifications (signed / expired / rejected).
// Secured by a shared secret; the payload itself is never trusted for identity.
import { createFileRoute } from "@tanstack/react-router";

function unwrap(payload: Record<string, unknown>): {
  envelopeId: string | null;
  status: string | null;
  downloadUrl: string | null;
} {
  const nested =
    (payload.data as Record<string, unknown> | undefined) ??
    (payload.envelope as Record<string, unknown> | undefined) ??
    (payload.signature as Record<string, unknown> | undefined) ??
    {};
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = (payload[k] ?? nested[k]) as unknown;
      if (typeof v === "string" && v) return v;
    }
    return null;
  };
  return {
    envelopeId: get(["id", "envelopeId", "envelope_id", "signatureId", "uuid"]),
    status: get(["status", "state", "event", "eventType"]),
    downloadUrl: get(["downloadUrl", "download_url", "documentUrl"]),
  };
}

export const Route = createFileRoute("/api/public/webhooks/bry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.BRY_WEBHOOK_SECRET;
        if (expected) {
          const provided =
            request.headers.get("x-bry-signature") ??
            request.headers.get("x-webhook-secret") ??
            new URL(request.url).searchParams.get("secret");
          if (provided !== expected) {
            console.warn("[bry:webhook] invalid secret");
            return new Response("unauthorized", { status: 401 });
          }
        }

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("invalid json", { status: 400 });
        }

        const { envelopeId, status, downloadUrl } = unwrap(payload);
        console.log("[bry:webhook]", JSON.stringify({ envelopeId, status }));
        if (!envelopeId) return new Response("missing envelope id", { status: 400 });

        try {
          const { BryRepository } = await import("@/lib/bry/repository.server");
          const { normalizeStatus, BryApi } = await import("@/lib/bry/bry.server");

          const row = await BryRepository.getByEnvelopeId(envelopeId);
          if (!row) {
            console.warn("[bry:webhook] unknown envelope", envelopeId);
            return new Response("ok");
          }

          const newStatus = normalizeStatus(status);
          await BryRepository.update(row.id, {
            status: newStatus,
            download_url: downloadUrl ?? row.download_url,
          });

          // On signature, fetch and archive the signed PDF right away.
          if (newStatus === "SIGNED" && !row.arquivo_assinado) {
            try {
              const bytes = await BryApi.downloadSignedPdf(
                envelopeId,
                downloadUrl ?? row.download_url,
              );
              const uploaded = await BryRepository.uploadSignedPdf({
                userId: row.user_id,
                envelopeId,
                filename: `${row.tipo_documento}_assinado.pdf`,
                bytes,
              });
              await BryRepository.update(row.id, { arquivo_assinado: uploaded.path, erro: null });
            } catch (e) {
              console.error("[bry:webhook] archive failed", e);
              await BryRepository.update(row.id, { erro: "Falha ao arquivar PDF assinado." });
            }
          }

          return new Response("ok");
        } catch (err) {
          console.error("[bry:webhook]", err);
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});