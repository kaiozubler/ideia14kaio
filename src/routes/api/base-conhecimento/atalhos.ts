import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

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
  atalho: z
    .string()
    .trim()
    .regex(/^\/\S+$/, "Atalho precisa começar com '/' e não ter espaços")
    .max(60),
  texto_completo: z.string().trim().min(1).max(4000),
  ias: z.array(z.enum(["chat_ai", "assistente_ai"])).min(1).max(2).optional().default(["chat_ai", "assistente_ai"]),
});

export const Route = createFileRoute("/api/base-conhecimento/atalhos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        const { data, error } = await auth.client
          .from("prompt_comandos")
          .select("id, atalho, texto_completo, ias, created_at")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("[base-conhecimento/atalhos:GET]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ atalhos: data });
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
          .from("prompt_comandos")
          .insert({ ...parsed.data, medico_id: auth.userId })
          .select("id, atalho, texto_completo, ias")
          .single();

        if (error) {
          // 23505 = unique_violation (medico_id + atalho já existe)
          if ((error as { code?: string }).code === "23505") {
            return Response.json({ error: "atalho_duplicado" }, { status: 409 });
          }
          console.error("[base-conhecimento/atalhos:POST]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ atalho: data });
      },

      DELETE: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

        const { error } = await auth.client.from("prompt_comandos").delete().eq("id", id);
        if (error) {
          console.error("[base-conhecimento/atalhos:DELETE]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
