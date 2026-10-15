import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { validarApresentacao } from "@/lib/medicamentos/apresentacao.server";

const ItensSchema = z.object({
  itens: z
    .array(
      z.object({
        apresentacao: z.string().min(1),
        texto_simplificado: z.string(),
        posologia_padrao: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

async function sha256(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

/**
 * O catálogo é compartilhado por todas as clínicas, então só quem tem o
 * CATALOGO_ADMIN_TOKEN (o operador do scripts/apresentacoes.mjs) lê a fila e
 * grava textos — um login comum não pode reescrever apresentações.
 */
async function exigirOperador(request: Request): Promise<Response | null> {
  const esperado = process.env["CATALOGO_ADMIN_TOKEN"];
  if (!esperado) return Response.json({ error: "missing_admin_token" }, { status: 500 });
  const recebido = request.headers.get("x-catalogo-token") ?? "";
  const [a, b] = await Promise.all([sha256(esperado), sha256(recebido)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? null : Response.json({ error: "unauthorized" }, { status: 401 });
}

/** Apresentações distintas da Anvisa que ainda não têm versão legível. */
async function listarPendentes(request: Request) {
  const negado = await exigirOperador(request);
  if (negado) return negado;
  const url = new URL(request.url);
  const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 500, 1), 20000);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

  const pendentes = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("medicamentos")
      .select("apresentacao")
      .is("apresentacao_simplificada", null)
      .not("apresentacao", "is", null)
      .neq("apresentacao", "")
      .order("id")
      .range(from, from + 999);
    if (error) return Response.json({ error: "read_failed" }, { status: 500 });
    (data ?? []).forEach((r) => {
      if (r.apresentacao && !feitos.has(r.apresentacao)) pendentes.add(r.apresentacao);
    });
    if (!data || data.length < 1000) break;
  }

  const todas = [...pendentes].sort();
  return Response.json({
    total: todas.length,
    ja_traduzidas: feitos.size,
    apresentacoes: todas.slice(0, limite),
  });
}

/**
 * Grava as versões legíveis no cache e propaga para medicamentos. Itens que
 * trazem números ausentes do original são recusados e devolvidos.
 */
async function importar(request: Request) {
  const negado = await exigirOperador(request);
  if (negado) return negado;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = ItensSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  const aceitos = [];
  const recusados: { apresentacao: string; motivo: string }[] = [];
  for (const it of parsed.data.itens) {
    const item = {
      apresentacao: it.apresentacao,
      texto_simplificado: it.texto_simplificado.trim(),
      posologia_padrao: (it.posologia_padrao ?? "").trim() || null,
    };
    const motivo = validarApresentacao(item);
    if (motivo) recusados.push({ apresentacao: item.apresentacao, motivo });
    else aceitos.push(item);
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (aceitos.length) {
    const { error } = await supabaseAdmin
      .from("apresentacao_legivel")
      .upsert(aceitos, { onConflict: "apresentacao" });
    if (error)
      return Response.json({ error: "write_failed", detail: error.message }, { status: 500 });
  }

  const { data: sincronizados, error: syncErr } = await supabaseAdmin.rpc(
    "sincronizar_apresentacao_legivel",
  );
  if (syncErr) console.error("[simplificar-apresentacoes] sync falhou:", syncErr.message);

  return Response.json({
    gravadas: aceitos.length,
    recusados,
    medicamentos_atualizados: sincronizados ?? null,
  });
}

export const Route = createFileRoute("/api/medicamentos/simplificar-apresentacoes")({
  server: {
    handlers: {
      GET: async ({ request }) => listarPendentes(request),
      POST: async ({ request }) => importar(request),
    },
  },
});
