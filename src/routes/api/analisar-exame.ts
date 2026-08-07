import { createFileRoute } from "@tanstack/react-router";
import { analisarExameArquivo, type AnexoExame } from "@/lib/exames/analise.server";

type Body = {
  arquivo?: AnexoExame;
  texto?: string;
  paciente?: { nome?: string | null; cpf?: string | null; data_nascimento?: string | null } | null;
};

export const Route = createFileRoute("/api/analisar-exame")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!body.arquivo?.base64) return new Response("Arquivo obrigatório", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          const analise = await analisarExameArquivo({
            apiKey,
            anexo: body.arquivo,
            texto: body.texto,
            paciente: body.paciente ?? null,
            buscarTuss: async (termo) => {
              const { data } = await supabaseAdmin.rpc("buscar_tuss", { termo, p_limit: 1 });
              const hit = (data as any[] | null)?.[0];
              return hit ? { codigo_tuss: hit.codigo_tuss, nome: hit.nome } : null;
            },
          });
          return Response.json(analise);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Falha na análise do exame";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});