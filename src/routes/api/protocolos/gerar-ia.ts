import { createFileRoute } from "@tanstack/react-router";
import { gerarProtocoloIA } from "@/lib/protocolos/gerar.server";

type Body = {
  pdf_base64?: string | null;
  filename?: string | null;
  observacao?: string | null;
};

export const Route = createFileRoute("/api/protocolos/gerar-ia")({
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          const resultado = await gerarProtocoloIA({
            apiKey: key,
            pdfBase64: body.pdf_base64 || null,
            filename: body.filename || null,
            observacao: body.observacao || null,
            buscarTuss: async (termo) => {
              const { data } = await supabaseAdmin.rpc("buscar_tuss", { termo, p_limit: 1 });
              const hit = (data as any[] | null)?.[0];
              return hit ? { id: hit.id, codigo_tuss: hit.codigo_tuss, nome: hit.nome } : null;
            },
            buscarSubstancia: async (termo) => {
              const { data } = await supabaseAdmin.rpc("buscar_genericos", { termo });
              const hit = (data as any[] | null)?.[0];
              return hit ? { id_substancia: hit.id_substancia, nome_exibicao: hit.nome_exibicao } : null;
            },
          });
          return Response.json(resultado);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Falha ao gerar protocolo";
          const status = /envie um pdf/i.test(msg) ? 400 : 500;
          return new Response(msg, { status });
        }
      },
    },
  },
});
