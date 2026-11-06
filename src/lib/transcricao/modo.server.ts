// Qual transcrição a conta usa nas consultas:
// - "avancada": Deepgram (cobrado por minuto) — só nos planos Pro e Enterprise,
//   e só se o médico não escolheu a básica em Minhas IAs › Copiloto.
// - "basica": reconhecimento de voz do próprio navegador (sem custo para nós).
//
// Decidido no servidor a cada token pedido, porque o navegador não é confiável
// para dizer o próprio plano. Secretária/enfermagem valem pelo plano da clínica.
export type ModoTranscricao = "avancada" | "basica";

const PLANOS_COM_AVANCADA = new Set(["pro", "enterprise"]);

export async function modoTranscricao(userId: string): Promise<ModoTranscricao> {
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

  const { data: assinatura, error } = await supabaseAdmin
    .from("assinaturas")
    .select("plano")
    .eq("medico_id", dono)
    .neq("status", "cancelada")
    .maybeSingle();
  if (error) {
    // Falha de consulta não pode tirar a transcrição de quem paga.
    console.warn("[transcricao] falha ao ler plano:", error.message);
    return "avancada";
  }
  if (!assinatura || !PLANOS_COM_AVANCADA.has(String(assinatura.plano))) return "basica";

  const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(userId);
  const preferencia = usuario?.user?.user_metadata?.transcricao;
  return preferencia === "basica" ? "basica" : "avancada";
}
