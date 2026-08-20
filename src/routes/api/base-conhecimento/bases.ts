import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Cliente com o token do próprio usuário: RLS garante que ele só enxerga/
// altera as bases dele (policy "medico_gerencia_suas_bases"). Não usamos
// service role aqui de propósito — não precisa e evita bypass de RLS.
function clienteDoUsuario(token: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function autenticar(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = clienteDoUsuario(token);
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  return { client, userId: data.user.id };
}

const CriarSchema = z.object({
  nome: z.string().trim().min(2).max(200),
  descricao: z.string().trim().max(600).optional().default(""),
  tags: z.array(z.string().trim().max(40)).max(10).optional().default([]),
  ias: z.array(z.enum(["chat_ai", "assistente_ai"])).min(1).max(2).optional().default(["chat_ai", "assistente_ai"]),
});

const AtualizarSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().trim().min(2).max(200).optional(),
  descricao: z.string().trim().max(600).optional(),
  tags: z.array(z.string().trim().max(40)).max(10).optional(),
  ias: z.array(z.enum(["chat_ai", "assistente_ai"])).min(1).max(2).optional(),
  ativo: z.boolean().optional(),
});

export const Route = createFileRoute("/api/base-conhecimento/bases")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        const { data, error } = await auth.client
          .from("base_conhecimento")
          .select("id, nome, descricao, tags, ias, ativo, created_at, base_conhecimento_itens(count)")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("[base-conhecimento/bases:GET]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ bases: data });
      },

      POST: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        const parsed = CriarSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "invalid_body", details: parsed.error.issues }, { status: 400 });
        }

        const { data, error } = await auth.client
          .from("base_conhecimento")
          .insert({ ...parsed.data, medico_id: auth.userId })
          .select("id, nome, descricao, tags, ias, ativo, created_at")
          .single();

        if (error) {
          console.error("[base-conhecimento/bases:POST]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ base: data });
      },

      PATCH: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        const parsed = AtualizarSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "invalid_body", details: parsed.error.issues }, { status: 400 });
        }
        const { id, ...patch } = parsed.data;

        const { data, error } = await auth.client
          .from("base_conhecimento")
          .update(patch)
          .eq("id", id)
          .select("id, nome, descricao, tags, ias, ativo")
          .single();

        if (error) {
          console.error("[base-conhecimento/bases:PATCH]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ base: data });
      },

      DELETE: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

        const { error } = await auth.client.from("base_conhecimento").delete().eq("id", id);
        if (error) {
          console.error("[base-conhecimento/bases:DELETE]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
