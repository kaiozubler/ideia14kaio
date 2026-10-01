import { createFileRoute } from "@tanstack/react-router";

/**
 * Dispara os avisos automáticos de consulta (confirmação de agendamento e
 * lembrete X horas antes) pelo WhatsApp de cada clínica conectada.
 * Mesmo esquema de autenticação de /api/public/hooks/sync-tuss (header
 * apikey). Agendar a cada 15 minutos, por exemplo com pg_cron + pg_net:
 *
 *   select cron.schedule('comunicacao-lembretes', '*\/15 * * * *', $$
 *     select net.http_post(
 *       url := 'https://<app>/api/public/hooks/comunicacao-lembretes',
 *       headers := jsonb_build_object('apikey', '<SUPABASE_PUBLISHABLE_KEY>')
 *     );
 *   $$);
 */
async function handle(request: Request) {
  const apikey = request.headers.get("apikey") || request.headers.get("x-api-key");
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!expected || apikey !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { processarAvisosAutomaticos } = await import("@/lib/comunicacao/lembretes.server");
    const resumo = await processarAvisosAutomaticos(supabaseAdmin as any);
    return Response.json({ ok: true, ...resumo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[comunicacao-lembretes]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/comunicacao-lembretes")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
