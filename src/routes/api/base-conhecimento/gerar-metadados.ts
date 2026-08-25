import { createFileRoute } from "@tanstack/react-router";
import { gerarDescricaoBase, type ChunkEntrada } from "@/lib/base-conhecimento/gerar.server";

type Body = {
  chunks?: ChunkEntrada[];
};

// Rota "pura": só chama a IA e devolve o resultado, sem tocar no banco (mesmo
// padrão de /api/questionarios/gerar-ia). Quem grava o resultado é o próprio
// front-end, via sb.from(...).update(...) — RLS garante que só atualiza os
// itens/bases do próprio médico.
//
// Só gera a descrição sugerida da base — não gera mais "perguntas
// relacionadas" por chunk: essa geração existia mas o resultado nunca era lido
// em lugar nenhum (nem na busca, nem na UI), então foi removida.
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
        if (chunks.length === 0) return Response.json({ descricao_sugerida: null });

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("LOVABLE_API_KEY não configurado", { status: 500 });

        try {
          const resultado = await gerarDescricaoBase({ apiKey: key, chunks });
          return Response.json({ descricao_sugerida: resultado.descricaoSugerida });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Falha ao gerar descrição";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
