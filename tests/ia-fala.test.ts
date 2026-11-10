// Voz do Assistente IA: o que é falado e o que fica só na tela.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { corpoGeminiFala, MAX_CARACTERES_FALA, normalizarParaFala } from "../src/lib/ia/fala.ts";

test("dados identificáveis nunca são falados", () => {
  const t = normalizarParaFala(
    "Encontrei Maria Silva — CPF 684.•••.•••-13, telefone (31) 9••••-1234. Confere?",
  );
  assert.doesNotMatch(t, /\d{2,}|•/);
  assert.match(t, /CPF na tela/);
  assert.equal(t, "Encontrei Maria Silva — CPF na tela, telefone na tela. Confere?");
  assert.match(normalizarParaFala("CPF 123.456.789-09"), /o número que está na tela/);
  assert.match(normalizarParaFala("Ligue para (31) 98765-4321"), /o número que está na tela/);
});

test("posologia, unidades, datas e horários viram fala por extenso", () => {
  assert.equal(
    normalizarParaFala("Amoxicilina 500mg VO de 8/8h por 7 dias."),
    "Amoxicilina 500 miligramas via oral de 8 em 8 horas por 7 dias.",
  );
  assert.equal(
    normalizarParaFala("Retorno 12/11 às 14h30."),
    "Retorno 12 de novembro às 14 horas e 30.",
  );
  assert.equal(
    normalizarParaFala("Consulta 05/03/2027 às 09:00"),
    "Consulta 5 de março de 2027 às 9 horas",
  );
  assert.equal(normalizarParaFala("Tomar 2x/dia"), "Tomar 2 vezes ao dia");
  assert.equal(normalizarParaFala("Dra. Ana e Dr. João"), "doutora Ana e doutor João");
});

test("formatação e links não são lidos, e o texto tem limite", () => {
  assert.equal(
    normalizarParaFala("**Pronto!** Veja https://x.com/a"),
    "Pronto! Veja o link na tela",
  );
  assert.equal(normalizarParaFala("- item um\n- item dois"), "item um item dois");
  assert.equal(normalizarParaFala("a".repeat(1000)).length, MAX_CARACTERES_FALA);
});

test("corpo segue o formato nativo do Gemini aceito pelo gateway", () => {
  const c = corpoGeminiFala("google/gemini-2.5-flash-tts", "Olá");
  assert.equal(c.contents[0].role, "user");
  assert.match(c.contents[0].parts[0].text, /Olá$/);
  assert.deepEqual(c.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(c.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
});
