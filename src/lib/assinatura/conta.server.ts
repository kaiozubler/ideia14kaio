// Assinatura vigente da CONTA de quem chama: a do próprio médico ou, para
// secretária/enfermagem (clinica_membros ativos), a do dono da clínica.
// `null` quando a conta não tem assinatura (plano Free).
// Lança erro se a consulta falhar, para cada chamador decidir se falha aberto.
export type AssinaturaDaConta = { plano: string; copiloto_ativo: boolean };

export async function assinaturaDaConta(userId: string): Promise<AssinaturaDaConta | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // clinica_membros não está nos tipos gerados do Supabase (mesmo padrão de src/lib/crm).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  let dono = userId;
  const { data: membro } = await db
    .from("clinica_membros")
    .select("clinica_id")
    .eq("user_id", userId)
    .eq("status", "ativo")
    .maybeSingle();
  if (membro?.clinica_id) dono = membro.clinica_id as string;

  const { data, error } = await supabaseAdmin
    .from("assinaturas")
    .select("plano, copiloto_ativo")
    .eq("medico_id", dono)
    .neq("status", "cancelada")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { plano: String(data.plano), copiloto_ativo: !!data.copiloto_ativo } : null;
}
