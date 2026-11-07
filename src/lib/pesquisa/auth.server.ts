import { z } from "zod";
import { clienteDoToken } from "./base.server";

export const ConsultaSchema = z.object({ q: z.string().trim().min(2).max(300) });

/** Usuário do token Bearer verificado + cliente que repassa esse token ao RLS. */
export async function autenticarPesquisa(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = clienteDoToken(token);
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return {
      client,
      user: data.user,
      metadata: (data.user.user_metadata ?? {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export async function lerConsulta(request: Request) {
  try {
    const parsed = ConsultaSchema.safeParse(await request.json());
    return parsed.success ? parsed.data.q : null;
  } catch {
    return null;
  }
}
