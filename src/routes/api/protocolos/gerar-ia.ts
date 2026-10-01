import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ErroGeracaoProtocolo, gerarProtocoloIA } from "@/lib/protocolos/gerar.server";

// ~14MB em base64 (~10MB de PDF) — mesmo teto de /api/ia/gerar-fluxo.
const BodySchema = z
  .object({
    pdf_base64: z.string().max(14_000_000).nullable().optional(),
    filename: z.string().max(200).nullable().optional(),
    observacao: z.string().max(20000).nullable().optional(),
  })
  .refine((b) => !!b.pdf_base64 || !!b.observacao?.trim(), {
    message: "Envie um PDF ou uma observação.",
  });

export const Route = createFileRoute("/api/protocolos/gerar-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Sem esta checagem qualquer visitante consumia créditos de IA.
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId)
          return new Response("Sessão expirada — faça login novamente.", { status: 401 });

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const body = BodySchema.safeParse(raw);
        if (!body.success) {
          return new Response(body.error.issues[0]?.message || "Payload inválido", { status: 400 });
        }

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("LOVABLE_API_KEY não configurado", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          const resultado = await gerarProtocoloIA({
            apiKey: key,
            pdfBase64: body.data.pdf_base64 || null,
            filename: body.data.filename || null,
            observacao: body.data.observacao || null,
            buscarTuss: async (termo) => {
              // Usa os apelidos que o próprio médico já corrigiu (exame_alias)
              // antes da busca aproximada no catálogo.
              const { data } = await supabaseAdmin.rpc("buscar_tuss", {
                termo,
                p_limit: 1,
                p_usar_alias: true,
                p_user_id: userId,
              });
              const hit = (data as any[] | null)?.[0];
              return hit ? { id: hit.id, codigo_tuss: hit.codigo_tuss, nome: hit.nome } : null;
            },
            buscarSubstancia: async (termo) => {
              const { data } = await supabaseAdmin.rpc("buscar_genericos", { termo });
              const hit = (data as any[] | null)?.[0];
              return hit
                ? { id_substancia: hit.id_substancia, nome_exibicao: hit.nome_exibicao }
                : null;
            },
          });
          return Response.json(resultado);
        } catch (err) {
          if (err instanceof ErroGeracaoProtocolo)
            return new Response(err.message, { status: err.status });
          console.error("[protocolos:gerar-ia]", err);
          return new Response("Falha ao gerar protocolo", { status: 500 });
        }
      },
    },
  },
});
