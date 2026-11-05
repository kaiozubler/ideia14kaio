import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Identidade da clínica e lista dos seus médicos para o link /agendar/{token}.
const QuerySchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });
const SEM_CACHE = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/public/agendamento/clinica")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const parsed = QuerySchema.safeParse({
          token: new URL(request.url).searchParams.get("token"),
        });
        if (!parsed.success)
          return Response.json({ error: "not_found" }, { status: 404, headers: SEM_CACHE });
        try {
          const { configDoLink, dadosDaClinica } = await import("@/lib/agendamento/publico.server");
          const cfg = await configDoLink(parsed.data.token);
          if (!cfg)
            return Response.json({ error: "not_found" }, { status: 404, headers: SEM_CACHE });
          return Response.json(await dadosDaClinica(cfg), { headers: SEM_CACHE });
        } catch (e) {
          console.error("[agendamento/clinica]", e);
          return Response.json({ error: "server_error" }, { status: 500, headers: SEM_CACHE });
        }
      },
    },
  },
});
