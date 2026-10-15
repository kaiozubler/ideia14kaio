// Textos legíveis das APRESENTAÇÕES da Anvisa.
//
// O texto original da Anvisa (ex.: "(0,015 + 0,06) MG COM REV CT BL AL PLAS
// PVC/ACLAR TRANS CALEND X 28 (24 + 4)") é ilegível na prescrição. As versões
// legíveis são escritas fora do app (pelo Claude, via scripts/apresentacoes.mjs,
// seguindo docs/APRESENTACOES_MEDICAMENTOS.md) e importadas por
// /api/medicamentos/simplificar-apresentacoes.
//
// O resultado é cacheado em public.apresentacao_legivel (chave = texto original)
// e propagado para public.medicamentos (apresentacao_simplificada / posologia_padrao).

export type ApresentacaoLegivel = {
  apresentacao: string;
  texto_simplificado: string;
  posologia_padrao: string | null;
};

function numeros(texto: string): Set<string> {
  const out = new Set<string>();
  for (const m of texto.matchAll(/\d+(?:[.,]\d+)*/g)) {
    // "0.5" e "0,5" são o mesmo número; "1.000" e "1000" também
    out.add(m[0].replace(/\./g, ",").replace(/,(\d{3})(?=,|$)/g, "$1"));
  }
  return out;
}

/**
 * Recusa textos que trazem números ausentes do original: a reescrita só pode
 * traduzir abreviações, nunca alterar dose, concentração ou quantidade.
 */
export function validarApresentacao(item: ApresentacaoLegivel): string | null {
  const texto = item.texto_simplificado.trim();
  if (!texto) return "texto vazio";
  if (texto.length > 240) return "texto longo demais";
  if ((item.posologia_padrao ?? "").length > 300) return "posologia longa demais";
  const originais = numeros(item.apresentacao);
  for (const n of numeros(texto)) {
    if (!originais.has(n)) return `número "${n}" não existe no original`;
  }
  return null;
}
