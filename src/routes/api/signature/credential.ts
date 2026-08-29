import { createFileRoute } from "@tanstack/react-router";
import { SignatureService } from "@/lib/signature/SignatureService";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

export const Route = createFileRoute("/api/signature/credential")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        try {
          const cred = await SignatureService.getCredential(userId);
          return Response.json({ credential: cred });
        } catch (err) {
          console.error("[signature/credential:GET]", err);
          return Response.json(
            { credential: null, error: err instanceof Error ? err.message : "internal_error" },
            { status: 200 },
          );
        }
      },
      DELETE: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        try {
          const result = await SignatureService.removeCredential(userId);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[signature/credential:DELETE]", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
