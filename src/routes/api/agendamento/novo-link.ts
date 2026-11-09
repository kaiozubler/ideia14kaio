import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Gera um novo link público de agendamento (o anterior para na hora).
// Regras em src/lib/agendamento/novo-link.server.ts.
const BodySchema = z.object({
  confirmacao: z.string().max(50),
  senha: z.string().max(200).optional(),
  email: z.string().max(255).optional(),
});

export const Route = createFileRoute("/api/agendamento/novo-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
        try {
          const { trocarLink } = await import("@/lib/agendamento/novo-link.server");
          const r = await trocarLink(request.headers.get("authorization"), parsed.data);
          if (!r.ok) return Response.json({ error: r.erro }, { status: r.status });
          return Response.json({ token: r.token });
        } catch (e) {
          console.error("[agendamento/novo-link]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
