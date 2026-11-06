import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Horários livres de um médico da clínica dona do link. Só devolve instantes
// livres: nada sobre quem ocupa os demais.
const QuerySchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  medico: z.string().uuid(),
});
const SEM_CACHE = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/public/agendamento/horarios")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({
          token: url.searchParams.get("token"),
          medico: url.searchParams.get("medico"),
        });
        if (!parsed.success)
          return Response.json({ error: "not_found" }, { status: 404, headers: SEM_CACHE });
        try {
          const { configDoLink, horariosDoMedico } =
            await import("@/lib/agendamento/publico.server");
          const cfg = await configDoLink(parsed.data.token);
          if (!cfg)
            return Response.json({ error: "not_found" }, { status: 404, headers: SEM_CACHE });
          const dias = await horariosDoMedico(cfg, parsed.data.medico);
          if (!dias)
            return Response.json({ error: "not_found" }, { status: 404, headers: SEM_CACHE });
          return Response.json({ dias }, { headers: SEM_CACHE });
        } catch (e) {
          console.error("[agendamento/horarios]", e);
          return Response.json({ error: "server_error" }, { status: 500, headers: SEM_CACHE });
        }
      },
    },
  },
});
