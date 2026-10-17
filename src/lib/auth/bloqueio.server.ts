// Acesso suspenso pelo Zubler CRM (tabela acessos_bloqueados): toda rota
// /api/* chamada com o token Supabase de um usuário bloqueado responde 403,
// conferido uma vez no middleware global (src/start.ts) em vez de em cada
// rota.
//
// O `sub` do JWT é lido sem verificar a assinatura de propósito: aqui ele só
// serve para NEGAR. Um token forjado com o sub de outra pessoa no máximo
// recebe 403; um bloqueado que forje outro sub continua barrado pela
// verificação de verdade que cada rota faz (exigirUsuario/getUserIdFromRequest).

const TTL_MS = 30_000;
const cache = new Map<string, { bloqueado: boolean; ate: number }>();

/** Descarta o cache local depois que o CRM bloqueia/libera (outras instâncias expiram em 30 s). */
export function esquecerBloqueios(ids: string[]) {
  for (const id of ids) cache.delete(id);
}

export function subDoJwt(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const partes = authorization.slice(7).split(".");
  if (partes.length !== 3) return null;
  try {
    const json = atob(partes[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { sub?: unknown; role?: unknown };
    // Só tokens de usuário logado: anon/service_role não têm "dono" para bloquear.
    if (payload.role !== "authenticated" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

async function estaBloqueado(userId: string): Promise<boolean> {
  const emCache = cache.get(userId);
  if (emCache && emCache.ate > Date.now()) return emCache.bloqueado;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from("acessos_bloqueados")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const bloqueado = !!data;
  cache.set(userId, { bloqueado, ate: Date.now() + TTL_MS });
  return bloqueado;
}

export const MENSAGEM_ACESSO_SUSPENSO = "Seu acesso está suspenso. Fale com o suporte Zubler.";

/** 403 para usuário bloqueado; null para seguir. Falha de leitura não derruba o app (o ban no Auth continua valendo). */
export async function respostaSeBloqueado(request: Request): Promise<Response | null> {
  const userId = subDoJwt(request.headers.get("authorization"));
  if (!userId) return null;
  try {
    if (!(await estaBloqueado(userId))) return null;
  } catch (err) {
    console.error("[bloqueio] não foi possível conferir acessos_bloqueados:", err);
    return null;
  }
  return Response.json(
    { error: "acesso_suspenso", message: MENSAGEM_ACESSO_SUSPENSO },
    { status: 403 },
  );
}
