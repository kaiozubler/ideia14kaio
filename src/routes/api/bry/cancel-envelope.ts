import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ id: z.string().uuid() });

export const Route = createFileRoute("/api/bry/cancel-envelope")({
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
          if (row.status === "SIGNED") {
            return Response.json({ error: "already_signed" }, { status: 409 });
          }

          await BryApi.cancelEnvelope(row.bry_envelope_id);
          const updated = await BryRepository.update(row.id, { status: "CANCELLED" });
          return Response.json({ ok: true, signature: updated });
        } catch (err) {
          return bryErrorResponse("cancel-envelope", err);
        }
      },
    },
  },
});