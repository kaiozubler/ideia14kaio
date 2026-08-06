import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z
  .object({
    tabela: z.string().regex(/^tuss-\d{1,3}$/).optional(),
    concurrency: z.number().int().min(1).max(10).optional(),
    batchPages: z.number().int().min(1).max(60).optional(),
    maxDurationMs: z.number().int().min(5000).max(240000).optional(),
    startPage: z.number().int().min(1).max(10000).optional(),
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
    const { syncTabelaTuss } = await import("@/lib/tuss/sync.server");
    const result = await syncTabelaTuss(parsed.data ?? {});
    return Response.json(result, { status: result.status === "erro" ? 500 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-tuss] erro inesperado:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/sync-tuss")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
