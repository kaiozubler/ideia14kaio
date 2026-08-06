import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const QuerySchema = z.object({
  q: z.string().max(200).optional(),
  tabela: z.string().regex(/^tuss-\d{1,3}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Pesquisa interna de procedimentos TUSS (código, nome ou descrição). */
async function handle(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "invalid_query", details: parsed.error.issues }, { status: 400 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );

  const { data, error } = await supabase.rpc("buscar_tuss", {
    termo: parsed.data.q ?? "",
    p_tabela: parsed.data.tabela ?? "tuss-22",
    p_limit: parsed.data.limit ?? 30,
  });

  if (error) {
    console.error("[tuss/buscar] erro:", error.message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
  return Response.json({ items: data ?? [] });
}

export const Route = createFileRoute("/api/tuss/buscar")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
    },
  },
});
