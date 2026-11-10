// Voz das respostas do Assistente IA: o texto mostrado na tela é ajustado
// aqui antes de virar áudio. Regras puras (sem servidor) para poderem ser
// testadas e para valerem igual em qualquer aparelho.
//
// - Dados identificáveis (CPF, telefone, valores mascarados com "•") nunca são
//   falados: a voz pode ser ouvida por quem está na sala; ficam só na tela.
// - Unidades, horários, datas e abreviações comuns viram fala por extenso,
//   porque o modelo de voz lê "mg" ou "8/8h" de forma imprevisível.

export const VOZ_PADRAO = "Kore";
export const MAX_CARACTERES_FALA = 450;

const INSTRUCAO_TOM = "Fale em português do Brasil, com tom calmo, cordial e objetivo: ";

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function normalizarParaFala(texto: string): string {
  let t = String(texto || "");

  // Formatação e links não se falam.
  t = t.replace(/https?:\/\/\S+/gi, "o link na tela");
  t = t.replace(/[*_`#>]+/g, " ");
  t = t.replace(/^\s*[-•]\s+/gm, "");

  // Dados identificáveis: mascarados, CPF e telefone ficam só na tela.
  t = t.replace(/(?:\(?\d{2}\)?\s?)?[\d().\-•]*•[\d().\-•]*[\d•]/g, " ");
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "o número que está na tela");
  t = t.replace(/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, "o número que está na tela");
  t = t.replace(/\b(CPF|telefone|celular)\s*:?\s*(?=[,.;]|$)/gim, "$1 na tela");

  // Posologia antes dos horários ("8/8h" não é data nem hora).
  t = t.replace(/\b(?:de\s+)?(\d{1,2})\s?\/\s?\1\s?h\b/gi, "de $1 em $1 horas");
  t = t.replace(/\b(\d+)\s?x\s?\/\s?dia\b/gi, "$1 vezes ao dia");
  t = t.replace(/\bVO\b/g, "via oral");

  // Datas dd/mm(/aaaa).
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (m, d, mes, ano) => {
    const dia = Number(d);
    const mi = Number(mes) - 1;
    if (dia < 1 || dia > 31 || mi < 0 || mi > 11) return m;
    return `${dia} de ${MESES[mi]}${ano && ano.length === 4 ? ` de ${ano}` : ""}`;
  });

  // Horários: 14h, 14h30, 14:30.
  t = t.replace(/\b(\d{1,2})h(\d{2})\b/gi, "$1 horas e $2");
  t = t.replace(/\b(\d{1,2})h\b/gi, "$1 horas");
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h, min) =>
    min === "00" ? `${Number(h)} horas` : `${Number(h)} e ${min}`,
  );

  // Unidades depois de número.
  t = t.replace(/(\d)\s?mcg\b/gi, "$1 microgramas");
  t = t.replace(/(\d)\s?mg\b/gi, "$1 miligramas");
  t = t.replace(/(\d)\s?ml\b/gi, "$1 mililitros");
  t = t.replace(/(\d)\s?kg\b/gi, "$1 quilos");
  t = t.replace(/(\d)\s?g\b/g, "$1 gramas");
  t = t.replace(/(\d)\s?UI\b/g, "$1 unidades internacionais");

  t = t.replace(/\bDra\./g, "doutora").replace(/\bDr\./g, "doutor");

  t = t
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return t.slice(0, MAX_CARACTERES_FALA);
}

/** Corpo no formato nativo do Gemini, que o gateway Lovable repassa ao Google. */
export function corpoGeminiFala(modelo: string, texto: string, voz = VOZ_PADRAO) {
  return {
    model: modelo,
    contents: [{ role: "user", parts: [{ text: INSTRUCAO_TOM + texto }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } },
    },
  };
}
