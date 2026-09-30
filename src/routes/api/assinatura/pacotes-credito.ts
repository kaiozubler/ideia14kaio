import { createFileRoute } from "@tanstack/react-router";

import { todosPacotesCredito } from "@/lib/plans/config";

// Tabela de pacotes de crédito avulso (quantidade + preço), servida pra
// tela Meu plano (public/meu-plano.js), que não passa pelo build do Vite e
// por isso não consegue importar src/lib/plans/config.ts direto. Mantém uma
// única fonte de preço: a mesma função que /api/assinatura/comprar-creditos
// usa pra validar a compra.
export const Route = createFileRoute("/api/assinatura/pacotes-credito")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(todosPacotesCredito(), {
          headers: { "Cache-Control": "public, max-age=300" },
        }),
    },
  },
});
