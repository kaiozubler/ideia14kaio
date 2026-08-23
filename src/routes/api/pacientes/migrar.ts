import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const BodySchema = z.object({
  origem_id: z.string().uuid(),
  destino_id: z.string().uuid(),
});

/**
 * Migra (mescla) todos os dados de um paciente para outro paciente do mesmo médico.
 * Todas as tabelas que referenciam paciente_id são reapontadas para o destino.
 * O cadastro de origem é removido no final (merge de duplicidade).
 */
const TABELAS: Array<{ tabela: string; coluna: string }> = [
  { tabela: "agendamentos", coluna: "paciente_id" },
  { tabela: "consulta", coluna: "paciente_id" },
  { tabela: "documentos_paciente", coluna: "paciente_id" },
  { tabela: "exames", coluna: "paciente_id" },
  { tabela: "lancamentos_financeiros", coluna: "paciente_id" },
  { tabela: "paciente_protocolos", coluna: "paciente_id" },
  { tabela: "protocolo_tarefas", coluna: "paciente_id" },
  { tabela: "questionario_envios", coluna: "paciente_id" },
  { tabela: "questionario_respostas", coluna: "paciente_id" },
  { tabela: "termo_assinaturas", coluna: "paciente_id" },
  { tabela: "timeline_events", coluna: "paciente_id" },
  { tabela: "whatsapp_conversas", coluna: "paciente_id" },
  { tabela: "resumo_prontuario", coluna: "paciente_id" },
];

async function handle(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const { origem_id, destino_id } = parsed.data;
  if (origem_id === destino_id) return Response.json({ error: "same_patient" }, { status: 400 });

  const supabaseUser = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"]!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: pacientes, error: pacErr } = await supabaseAdmin
    .from("pacientes")
    .select("paciente_id, user_id, name, dados_clinicos, cids, parentescos")
    .in("paciente_id", [origem_id, destino_id]);

  if (pacErr) return Response.json({ error: "lookup_failed" }, { status: 500 });
  const origem = (pacientes ?? []).find((p) => p.paciente_id === origem_id);
  const destino = (pacientes ?? []).find((p) => p.paciente_id === destino_id);
  if (!origem || !destino) return Response.json({ error: "not_found" }, { status: 404 });
  if (origem.user_id !== userId || destino.user_id !== userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const movidos: Record<string, number> = {};
  for (const { tabela, coluna } of TABELAS) {
    const { data, error } = await supabaseAdmin
      .from(tabela)
      .update({ [coluna]: destino_id })
      .eq(coluna, origem_id)
      .select("*", { count: "exact", head: false });
    if (error) {
      console.error(`[pacientes/migrar] ${tabela}:`, error.message);
      return Response.json({ error: "migration_failed", tabela }, { status: 500 });
    }
    movidos[tabela] = Array.isArray(data) ? data.length : 0;
  }

  // mescla campos textuais / listas do cadastro
  const asArray = (v: unknown) => (Array.isArray(v) ? v : []);
  const cids = [...asArray(destino.cids)];
  for (const c of asArray(origem.cids)) {
    const code = typeof c === "string" ? c : (c as { code?: string })?.code;
    const existe = cids.some((d) => {
      const dc = typeof d === "string" ? d : (d as { code?: string })?.code;
      return dc && code && dc === code;
    });
    if (!existe) cids.push(c);
  }
  const parentescos = [...asArray(destino.parentescos)];
  for (const p of asArray(origem.parentescos)) {
    const pid = (p as { paciente_id?: string })?.paciente_id;
    if (pid === destino_id) continue;
    const existe = parentescos.some(
      (d) =>
        (pid && (d as { paciente_id?: string })?.paciente_id === pid) ||
        (!pid && (d as { nome?: string })?.nome === (p as { nome?: string })?.nome),
    );
    if (!existe) parentescos.push(p);
  }
  const dcOrigem = (origem.dados_clinicos ?? "").toString().trim();
  const dcDestino = (destino.dados_clinicos ?? "").toString().trim();
  const dados_clinicos = dcOrigem && !dcDestino.includes(dcOrigem)
    ? [dcDestino, dcOrigem].filter(Boolean).join("\n\n")
    : dcDestino;

  const { error: upErr } = await supabaseAdmin
    .from("pacientes")
    .update({ cids, parentescos, dados_clinicos })
    .eq("paciente_id", destino_id);
  if (upErr) {
    console.error("[pacientes/migrar] merge cadastro:", upErr.message);
    return Response.json({ error: "merge_failed" }, { status: 500 });
  }

  const { error: delErr } = await supabaseAdmin
    .from("pacientes")
    .delete()
    .eq("paciente_id", origem_id);
  if (delErr) {
    console.error("[pacientes/migrar] delete origem:", delErr.message);
    return Response.json({ ok: true, movidos, origem_removida: false });
  }

  return Response.json({ ok: true, movidos, origem_removida: true, destino_id });
}

export const Route = createFileRoute("/api/pacientes/migrar")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
