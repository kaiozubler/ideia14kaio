import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z
  .object({
    concurrency: z.number().int().min(1).max(3).optional(),
    batchSize: z.number().int().min(1).max(50).optional(),
    delayMs: z.number().int().min(200).max(5000).optional(),
    maxDurationMs: z.number().int().min(5000).max(120000).optional(),
    resume: z.boolean().optional(),
  })
  .strict()
  .optional();

async function handle(request: Request) {
  const apikey = request.headers.get("apikey") || request.headers.get("x-api-key");
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!expected || apikey !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.CRFMG_API_KEY) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  let raw: unknown = undefined;
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : undefined;
  } catch {
    raw = undefined;
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.issues }, { status: 400 });
  }

  try {
    const { sincronizarInteracoes } = await import("@/lib/interacoes/sync.server");
    const result = await sincronizarInteracoes(parsed.data ?? {});
    return Response.json(result, { status: result.status === "erro" ? 500 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-interacoes] erro inesperado:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/sync-interacoes")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});