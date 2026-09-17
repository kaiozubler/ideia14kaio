import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Proxy pro botão "Gerar com IA" do Studio de protocolos.
//
// Por que isso existe: chamar a IA direto do navegador exigiria colocar a
// chave no JS do cliente, visível pra qualquer visitante da página. Essa
// rota resolve isso: o front chama ESTA rota (mesma origem, sem CORS, sem
// chave exposta), e ela chama o provedor com a chave guardada no servidor.
//
// Usa o mesmo AI Gateway do Lovable que o resto do app já usa (ver
// src/lib/protocolos/gerar.server.ts), em vez de chamar a Anthropic direto —
// assim reaproveita a LOVABLE_API_KEY que já está configurada, sem precisar
// de um secret novo. Formato de resposta é o do gateway (OpenAI-compatible:
// choices[0].message.content), não o da Anthropic Messages API — o front em
// public/protocolo-studio.html (generateFlowFromAI) já espera esse formato.
//
// pdfBase64/filename são opcionais: quando presentes, monta um bloco
// "file" no content igual ao que gerar.server.ts já usa pro fluxo oficial
// (o gateway aceita PDF nesse formato, o modelo lê o documento direto).
//
// Já plugado em public/protocolo-studio.html (generateFlowFromAI chama
// /api/ia/gerar-fluxo via studioFetch, que também manda o Bearer token da
// sessão logada — essa rota exige usuário autenticado).

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

// ~14MB em base64 (~10MB de PDF real) -- generoso o bastante pra um
// protocolo em PDF, sem deixar o payload crescer sem limite.
const BodySchema = z.object({
  prompt: z.string().min(1).max(20000),
  pdfBase64: z.string().max(14_000_000).nullable().optional(),
  filename: z.string().max(200).nullable().optional(),
});

export const Route = createFileRoute("/api/ia/gerar-fluxo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = BodySchema.safeParse(await request.json());
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: "LOVABLE_API_KEY não configurada no servidor" }, { status: 500 });

        const content: Array<Record<string, unknown>> = [{ type: "text", text: body.data.prompt }];
        if (body.data.pdfBase64) {
          content.push({
            type: "file",
            file: {
              filename: body.data.filename || "protocolo.pdf",
              file_data: `data:application/pdf;base64,${body.data.pdfBase64}`,
            },
          });
        }

        const resp = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": apiKey,
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 8000,
            messages: [{ role: "user", content }],
          }),
        });

        const data = await resp.json();
        if (!resp.ok) return Response.json({ error: data?.error?.message || "erro no AI gateway" }, { status: resp.status });

        return Response.json(data);
      },
    },
  },
});
