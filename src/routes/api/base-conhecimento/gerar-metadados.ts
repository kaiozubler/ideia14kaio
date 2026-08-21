import { createFileRoute } from "@tanstack/react-router";
import { gerarMetadadosChunks, type ChunkEntrada } from "@/lib/base-conhecimento/gerar.server";

type Body = {
  chunks?: ChunkEntrada[];
  gerar_descricao?: boolean;
};

// Rota "pura": só chama a IA e devolve o resultado, sem tocar no banco (mesmo
// padrão de /api/questionarios/gerar-ia). Quem grava o resultado é o próprio
// front-end, via sb.from(...).update(...) — RLS garante que só atualiza os
// itens/bases do próprio médico.
export const Route = createFileRoute("/api/base-conhecimento/gerar-metadados")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const chunks = Array.isArray(body.chunks) ? body.chunks : [];
        if (chunks.length === 0) return Response.json({ descricao_sugerida: null, itens: [] });

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("LOVABLE_API_KEY não configurado", { status: 500 });

        try {
          const resultado = await gerarMetadadosChunks({
            apiKey: key,
            chunks,
            gerarDescricao: !!body.gerar_descricao,
          });
          return Response.json({ descricao_sugerida: resultado.descricaoSugerida, itens: resultado.itens });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Falha ao gerar metadados";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
