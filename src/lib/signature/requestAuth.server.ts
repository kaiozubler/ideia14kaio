/**
 * Identifica o usuário logado a partir do header Authorization: Bearer.
 * Centralizado aqui porque as ~8 rotas de assinatura duplicavam essa mesma
 * função — e cada cópia tratava falhas do Supabase Auth de um jeito
 * diferente (algumas propagavam o erro cru pra fora, produzindo mensagens
 * como "Claim 'iss' not trusted" ou "[object Object]" na tela do usuário
 * em vez de um 401 comum).
 *
 * Qualquer falha aqui — token de outro projeto/sessão obsoleta, erro de
 * rede, o que for — vira "não autenticado" (retorna null), nunca uma
 * exceção que vaze detalhe interno do Supabase pro chamador. Do ponto de
 * vista de quem chama, um token inválido e um token ausente são a mesma
 * coisa: sem sessão válida.
 */
export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (!token) return null;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error) {
      console.warn("[signature/auth] token rejeitado pelo Supabase Auth:", error.message ?? error);
      return null;
    }
    return data.user?.id ?? null;
  } catch (err) {
    console.warn(
      "[signature/auth] falha ao validar token:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
