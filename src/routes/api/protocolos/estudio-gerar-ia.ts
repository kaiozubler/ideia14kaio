import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ErroGeracaoProtocolo } from "@/lib/protocolos/gerar.server";
import { gerarFluxoEstudioIA } from "@/lib/protocolos/estudio-gerar.server";

// "Gerar com IA" do Studio de protocolos. Substitui o uso de /api/ia/gerar-fluxo
// pelo Studio: lá o prompt vinha do navegador e a resposta ia crua para o
// canvas; aqui o prompt é do servidor e o grafo volta validado e vinculado ao
// catálogo (ver src/lib/protocolos/estudio-gerar.server.ts).

// ~14MB em base64 (~10MB de PDF).
const BodySchema = z
  .object({
    texto: z.string().max(20000).nullable().optional(),
    pdfBase64: z.string().max(14_000_000).nullable().optional(),
    filename: z.string().max(200).nullable().optional(),
    contexto: z.string().max(8000).nullable().optional(),
  })
  .refine((b) => !!b.pdfBase64 || !!b.texto?.trim(), { message: "Envie um PDF ou um texto." });

export const Route = createFileRoute("/api/protocolos/estudio-gerar-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId)
          return Response.json(
            { error: "Sessão expirada — faça login novamente." },
            { status: 401 },
          );

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const body = BodySchema.safeParse(raw);
        if (!body.success) {
          return Response.json(
            { error: body.error.issues[0]?.message || "Payload inválido" },
            { status: 400 },
          );
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey)
          return Response.json(
            { error: "LOVABLE_API_KEY não configurada no servidor" },
            { status: 500 },
          );

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const fluxo = await gerarFluxoEstudioIA({
            apiKey,
            texto: body.data.texto || null,
            pdfBase64: body.data.pdfBase64 || null,
            filename: body.data.filename || null,
            contexto: body.data.contexto || null,
            buscarTuss: async (termo) => {
              // apelidos já corrigidos pelo próprio médico (exame_alias) primeiro
              const { data } = await supabaseAdmin.rpc("buscar_tuss", {
                termo,
                p_limit: 1,
                p_usar_alias: true,
                p_user_id: userId,
              });
              const hit = (data as { id: string; codigo_tuss: string; nome: string }[] | null)?.[0];
              return hit ? { id: hit.id, codigo_tuss: hit.codigo_tuss, nome: hit.nome } : null;
            },
            buscarSubstancia: async (termo) => {
              const { data } = await supabaseAdmin.rpc("buscar_genericos", { termo });
              const hit = (data as { id_substancia: string; nome_exibicao: string }[] | null)?.[0];
              return hit
                ? { id_substancia: hit.id_substancia, nome_exibicao: hit.nome_exibicao }
                : null;
            },
          });
          return Response.json(fluxo);
        } catch (err) {
          if (err instanceof ErroGeracaoProtocolo)
            return Response.json({ error: err.message }, { status: err.status });
          console.error("[estudio:gerar-ia]", err);
          return Response.json({ error: "Falha ao gerar o fluxo" }, { status: 500 });
        }
      },
    },
  },
});
