import { createFileRoute } from "@tanstack/react-router";
import { rotaCrm } from "@/lib/crm/rota.server";

// Zubler CRM: teste de conexão — responde só se o CRM_BRIDGE_TOKEN estiver certo.
export const Route = createFileRoute("/api/public/crm/health")({
  server: {
    handlers: {
      GET: rotaCrm(async () => ({ ok: true })),
    },
  },
});
