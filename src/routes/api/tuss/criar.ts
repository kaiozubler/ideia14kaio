import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const BodySchema = z.object({
  nome: z.string().trim().min(3, "Nome muito curto").max(300, "Nome muito longo"),
});

const normaliza = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Cria um procedimento TUSS "pendente de cadastro" a partir do nome digitado
 * pelo médico no modal de Protocolos, quando a busca não encontra nada no
 * catálogo oficial (sincronizado da ANS).
 *
 * A tabela tuss_procedimentos tem RLS restritiva que bloqueia INSERT para
 * `authenticated` (só service_role escreve — ver migration
 * 20260806111048). Essa rota mantém essa garantia: valida o usuário com o
 * token dele, mas o INSERT em si é feito com supabaseAdmin (service_role).
 * O registro criado fica com status = 'pendente_cadastro' e um codigo_tuss
 * placeholder (PEND-XXXXXXXX), para ser completado manualmente depois
 * (ver query de revisão no final deste arquivo, em comentário).
 */
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
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", details: parsed.error.issues }, { status: 400 });
  }
  const nome = parsed.data.nome.replace(/\s+/g, " ").trim();

  // valida o usuário com o próprio token dele (client "anon", sem privilégio de escrita)
  const supabaseUser = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // dedupe: se já existir um procedimento com nome equivalente (ignorando
  // acento/caixa), reaproveita em vez de criar duplicado por variação de
  // digitação ("RM crânio" vs "Ressonância magnética de crânio" não vão
  // colidir aqui — isso é esperado; dedupe cobre só grafia próxima).
  const { data: candidatos } = await supabaseAdmin
    .from("tuss_procedimentos")
    .select("id, codigo_tuss, nome")
    .ilike("nome", nome)
    .limit(5);

  const alvo = normaliza(nome);
  const existente = (candidatos ?? []).find((c) => normaliza(c.nome as string) === alvo);
  if (existente) {
    return Response.json({
      item: { id: existente.id, nome: existente.nome, codigo_tuss: existente.codigo_tuss },
      criado: false,
    });
  }

  // gera um código placeholder único; tenta de novo em caso de colisão (raríssimo)
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigoTuss = `PEND-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const { data: inserido, error } = await supabaseAdmin
      .from("tuss_procedimentos")
      .insert({
        codigo_tuss: codigoTuss,
        nome,
        tabela: "tuss-22",
        status: "pendente_cadastro",
        dados_originais: { origem: "cadastro_manual", criado_por: userId, nome_original: nome },
      })
      .select("id, codigo_tuss, nome")
      .single();

    if (!error && inserido) {
      return Response.json({ item: inserido, criado: true });
    }
    // 23505 = unique_violation (colisão de codigo_tuss); qualquer outro erro, para de tentar
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("[tuss/criar] erro:", error.message);
      return Response.json({ error: "insert_failed" }, { status: 500 });
    }
  }
  return Response.json({ error: "insert_failed" }, { status: 500 });
}

export const Route = createFileRoute("/api/tuss/criar")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

/*
 * Query de revisão periódica (rodar direto no Supabase / painel):
 *
 *   SELECT id, codigo_tuss, nome, created_at
 *   FROM public.tuss_procedimentos
 *   WHERE status = 'pendente_cadastro'
 *   ORDER BY created_at DESC;
 *
 * Ao revisar, dá pra fazer o UPDATE direto com o código TUSS real, grupo,
 * classe etc., e trocar status para 'ativo'. Não precisa apagar/recriar a
 * linha — os protocolos que já vincularam (protocolo_acoes.tuss_procedimento_id)
 * continuam apontando pro mesmo id.
 */
