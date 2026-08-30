// Traduz o erro técnico devolvido pelo AI gateway (Lovable AI) numa mensagem
// que faz sentido pro médico/secretária ver na tela — sem status code, sem
// JSON cru, sem termos internos como "gateway" ou "créditos" (que soam como
// um problema do usuário, quando na verdade é da conta do sistema).
//
// O texto técnico completo continua disponível pra quem loga o erro no
// servidor (console.error) antes de chamar esta função — só a MENSAGEM
// exibida ao usuário é que fica genérica.
export function mensagemErroGateway(status: number): string {
  switch (status) {
    case 402:
      // "Not enough credits" do gateway — problema de conta/faturamento do
      // sistema, não algo que o médico causou ou pode resolver sozinho.
      return "A IA está temporariamente indisponível. Nossa equipe já foi avisada — tente novamente em alguns minutos.";
    case 429:
      return "A IA está com muitas solicitações agora. Tente novamente em instantes.";
    case 401:
    case 403:
      return "A IA está temporariamente indisponível. Nossa equipe já foi avisada.";
    default:
      return "Não consegui falar com a IA agora. Tente novamente em instantes.";
  }
}
