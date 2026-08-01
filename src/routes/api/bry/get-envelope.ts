import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bry/get-envelope")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getUserIdFromRequest, bryErrorResponse } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "id_required" }, { status: 400 });

        try {
          const { BryRepository } = await import("@/lib/bry/repository.server");
          const { BryApi } = await import("@/lib/bry/bry.server");

          const row = await BryRepository.getById(id, userId);
          if (!row) return Response.json({ error: "not_found" }, { status: 404 });

          // Already final: no need to hit BRY again.
          if (row.status !== "PENDING" || !row.bry_envelope_id) {
            return Response.json({ ok: true, signature: row });
          }

          const remote = await BryApi.getEnvelope(row.bry_envelope_id);
          const updated =
            remote.status !== row.status || remote.downloadUrl !== row.download_url
              ? await BryRepository.update(row.id, {
                  status: remote.status,
                  download_url: remote.downloadUrl ?? row.download_url,
                  sign_url: remote.signUrl ?? row.sign_url,
                })
              : row;

          return Response.json({ ok: true, signature: updated, status: remote.status });
        } catch (err) {
          return bryErrorResponse("get-envelope", err);
        }
      },
    },
  },
});