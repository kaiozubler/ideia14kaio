import { createFileRoute } from "@tanstack/react-router";
import { gerarTermoIA } from "@/lib/termos/gerar.server";

type Body = {
  observacao?: string | null;
};

export const Route = createFileRoute("/api/termos/gerar-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("LOVABLE_API_KEY não configurado", { status: 500 });

        try {
          const resultado = await gerarTermoIA({
            apiKey: key,
            observacao: body.observacao || null,
          });
          return Response.json(resultado);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Falha ao gerar termo";
          const status = /escreva uma instrução/i.test(msg) ? 400 : 500;
          return new Response(msg, { status });
        }
      },
    },
  },
});
