import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { simplificarLote } from "@/lib/medicamentos/apresentacao.server";

const BodySchema = z.object({
  // quantas apresentações distintas processar nesta chamada
  limite: z.number().int().min(1).max(2000).optional(),
});

const TAM_LOTE = 8;
const CONCORRENCIA = 6;

/**
 * Processa (de forma retomável) as apresentações da Anvisa que ainda não têm
 * versão legível: chama a IA, grava o cache em apresentacao_legivel e propaga
 * para medicamentos.apresentacao_simplificada / posologia_padrao.
 *
 * Requer usuário autenticado (o token é validado antes de qualquer trabalho);
 * a escrita usa o cliente administrativo porque o catálogo é somente-leitura
 * para o app.
 */
async function handle(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const anon = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const limite = parsed.data.limite ?? 200;

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return Response.json({ error: "missing_api_key" }, { status: 500 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // apresentações já traduzidas (cache)
  const feitos = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("apresentacao_legivel")
      .select("apresentacao")
      .range(from, from + 999);
    if (error) return Response.json({ error: "cache_read_failed" }, { status: 500 });
    (data ?? []).forEach((r) => feitos.add(r.apresentacao));
    if (!data || data.length < 1000) break;
  }

  // apresentações distintas pendentes
  const pendentes = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("medicamentos")
      .select("apresentacao")
      .not("apresentacao", "is", null)
      .neq("apresentacao", "")
      .range(from, from + 999);
    if (error) return Response.json({ error: "read_failed" }, { status: 500 });
    (data ?? []).forEach((r) => {
      const a = r.apresentacao;
      if (a && !feitos.has(a)) pendentes.add(a);
    });
    if (!data || data.length < 1000) break;
  }

  const alvo = [...pendentes].slice(0, limite);
  if (alvo.length === 0) {
    return Response.json({ pendentes: 0, processadas: 0, falhas: 0, restantes: 0 });
  }

  const lotes: string[][] = [];
  for (let i = 0; i < alvo.length; i += TAM_LOTE) lotes.push(alvo.slice(i, i + TAM_LOTE));

  let processadas = 0;
  let falhas = 0;

  async function worker(fila: string[][]) {
    for (const lote of fila) {
      try {
        const rows = await simplificarLote({ apiKey: apiKey!, apresentacoes: lote });
        if (rows.length) {
          const { error } = await supabaseAdmin
            .from("apresentacao_legivel")
            .upsert(rows, { onConflict: "apresentacao" });
          if (error) throw new Error(error.message);
          processadas += rows.length;
        }
      } catch (err) {
        falhas++;
        console.error(
          "[simplificar-apresentacoes] lote falhou:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const filas = Array.from({ length: CONCORRENCIA }, (_, k) =>
    lotes.filter((_, i) => i % CONCORRENCIA === k),
  );
  await Promise.all(filas.map(worker));

  // propaga o cache para a tabela de medicamentos
  const { error: syncErr } = await supabaseAdmin.rpc("sincronizar_apresentacao_legivel");
  if (syncErr) console.error("[simplificar-apresentacoes] sync falhou:", syncErr.message);

  return Response.json({
    pendentes: pendentes.size,
    processadas,
    falhas,
    restantes: Math.max(0, pendentes.size - processadas),
  });
}

export const Route = createFileRoute("/api/medicamentos/simplificar-apresentacoes")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
