// Regras de tempo para as IAs que leem o histórico do paciente (anamnese,
// resumo do prontuário, copiloto). O histórico mistura dados permanentes
// (alergias, doenças crônicas, cirurgias) com situações que já passaram
// (um analgésico de 3 anos atrás); sem a data de hoje e sem estas regras, a
// IA tratava tudo o que aparece no prontuário como atual.

/** Data de hoje em Brasília (dd/mm/aaaa), independente do fuso do servidor. */
export function dataHojeBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(agora);
}

/** Data de hoje em Brasília (aaaa-mm-dd) — toISOString() vira o dia seguinte depois das 21h. */
export function hojeISOBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function regrasTemporais(hoje: string): string {
  return `# DATA E ATUALIDADE DAS INFORMAÇÕES
Data de hoje: ${hoje}.
O histórico do paciente (resumo do prontuário, informações complementares, atendimentos e receitas anteriores) descreve o passado e pode estar desatualizado. Antes de usar cada informação, decida se ela é PERMANENTE ou se é uma SITUAÇÃO que pode ter mudado:
- Permanentes — mantenha sempre: alergias e reações adversas, doenças crônicas, cirurgias e internações, antecedentes familiares, gestações, vacinas aplicadas.
- Situações que mudam — medicamentos, sintomas, queixas, hábitos (tabagismo, etilismo), peso e resultados de exame: só descreva como ATUAL o que for recente ou confirmado no atendimento de hoje.
Medicamentos:
- "Em uso hoje" é apenas o que aparece como vigente na lista "Medicamentos prescritos (com data limite)" ou o que o paciente/médico confirmou no atendimento atual.
- Tratamento com data limite já vencida, ou citado só em atendimento/receita antiga, é HISTÓRICO: registre como uso prévio com a data (ex.: "dipirona em 03/2023, tratamento encerrado"), nunca como uso atual.
- Medicamento de uso contínuo prescrito há muito tempo e não mencionado hoje: cite como "prescrito em <data> — confirmar se mantém o uso".
- Se o histórico e o atendimento atual divergirem, prevalece o atendimento atual; aponte a divergência quando for clinicamente relevante.
- Quando não for possível saber se algo ainda vale, não afirme: use [CONFIRMAR COM O PACIENTE].
Sempre que citar um dado do histórico, indique de quando ele é, se a data estiver disponível.`;
}
