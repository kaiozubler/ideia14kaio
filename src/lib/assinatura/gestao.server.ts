// Helpers compartilhados pelas rotas /api/assinatura/* (tela Meu plano).
// Só servidor — usa service role.

import { AsaasApiError, AsaasNaoConfiguradoError } from "@/lib/asaas/client.server";

export async function clienteAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // As colunas novas de assinaturas (plano_agendado, cancelamento_*, cartao_*)
  // ainda não constam no types.ts gerado — remover este cast depois de
  // rodar a migration 20261001120000_meu_plano_gestao + regenerar tipos.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

export async function usuarioDaRequisicao(request: Request): Promise<string | null> {
  const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
  return getUserIdFromRequest(request);
}

/** Assinatura não-cancelada de quem está logado, ou null. */
export async function assinaturaAtiva(userId: string) {
  const supabaseAdmin = await clienteAdmin();
  const { data, error } = await supabaseAdmin
    .from("assinaturas")
    .select("*")
    .eq("medico_id", userId)
    .neq("status", "cancelada")
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/** Traduz erros do Asaas pro mesmo formato de resposta usado em todas as rotas de assinatura. */
export function respostaErroAsaas(escopo: string, err: unknown): Response {
  if (err instanceof AsaasNaoConfiguradoError)
    return Response.json({ error: err.message }, { status: 501 });
  if (err instanceof AsaasApiError) return Response.json({ error: err.message }, { status: 502 });
  console.error(`[assinatura:${escopo}] erro inesperado:`, err);
  return Response.json({ error: "erro inesperado" }, { status: 500 });
}

export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}
