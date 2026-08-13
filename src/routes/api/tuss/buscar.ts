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

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? null;

  // p_tabela: quando o front não pede uma tabela TUSS específica, deixamos
  // null propositalmente — buscar_tuss() já trata null como "sem filtro de
  // tabela" (WHERE p.tabela = coalesce(p_tabela, p.tabela) vira sempre
  // verdadeiro). Antes isso vinha fixo em 'tuss-22', então exames
  // cadastrados em outras tabelas (ex.: exames laboratoriais/oftalmológicos
  // sincronizados sob outro código de tabela) nunca apareciam na busca do
  // modal "Editar protocolo", mesmo já existindo em tuss_procedimentos.
  const { data, error } = await supabase.rpc("buscar_tuss", {
    termo: parsed.data.q ?? "",
    p_tabela: parsed.data.tabela ?? null,
    p_limit: parsed.data.limit ?? 30,
    p_usar_alias: true,
    p_user_id: userId,
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
