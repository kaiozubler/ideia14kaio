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
  const { assinaturaDaConta } = await import("@/lib/assinatura/conta.server");
  let assinatura;
  try {
    assinatura = await assinaturaDaConta(userId);
  } catch (err) {
    // Falha de consulta não pode tirar a transcrição de quem paga.
    console.warn("[transcricao] falha ao ler plano:", err instanceof Error ? err.message : err);
    return "avancada";
  }
  if (!assinatura || !PLANOS_COM_AVANCADA.has(assinatura.plano)) return "basica";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(userId);
  const preferencia = usuario?.user?.user_metadata?.transcricao;
  return preferencia === "basica" ? "basica" : "avancada";
}
