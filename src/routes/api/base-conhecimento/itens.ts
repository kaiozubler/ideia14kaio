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

// Estimativa simples de tokens (~4 caracteres por token). Só usada para
// exibir o "custo" aproximado na tela — não precisa ser exata.
const estimarTokens = (texto: string) => Math.max(1, Math.round(texto.length / 4));

// Chunks de ~1600 caracteres (~400 tokens), quebrando em parágrafos quando
// possível, pra manter a busca textual e a injeção no prompt granulares.
function dividirEmChunks(texto: string, tamanho = 1600): string[] {
  const partes: string[] = [];
  let restante = texto.trim();
  while (restante.length > tamanho) {
    let corte = restante.lastIndexOf("\n\n", tamanho);
    if (corte < tamanho * 0.5) corte = tamanho;
    partes.push(restante.slice(0, corte).trim());
    restante = restante.slice(corte).trim();
  }
  if (restante) partes.push(restante);
  return partes;
}

const CriarItemSchema = z.object({
  base_id: z.string().uuid(),
  tipo: z.enum(["arquivo", "texto"]),
  nome_original: z.string().trim().max(300).optional(),
  conteudo: z.string().trim().min(1).max(200_000),
});

export const Route = createFileRoute("/api/base-conhecimento/itens")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        const parsed = CriarItemSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "invalid_body", details: parsed.error.issues }, { status: 400 });
        }
        const { base_id, tipo, nome_original, conteudo } = parsed.data;

        const chunks = dividirEmChunks(conteudo);
        const linhas = chunks.map((chunk, ordem) => ({
          base_id,
          medico_id: auth.userId,
          tipo,
          nome_original: nome_original ?? null,
          conteudo: chunk,
          tokens_estimados: estimarTokens(chunk),
          ordem,
        }));

        const { data, error } = await auth.client.from("base_conhecimento_itens").insert(linhas).select("id");

        if (error) {
          console.error("[base-conhecimento/itens:POST]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({
          criados: data?.length ?? 0,
          tokens_estimados: linhas.reduce((s, l) => s + l.tokens_estimados, 0),
        });
      },

      DELETE: async ({ request }) => {
        const auth = await autenticar(request);
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

        const { error } = await auth.client.from("base_conhecimento_itens").delete().eq("id", id);
        if (error) {
          console.error("[base-conhecimento/itens:DELETE]", error.message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
