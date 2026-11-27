// Link da teleconsulta enviado ao paciente: página do app em vez do *.daily.co.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { linkConsultaPaciente, salaDoLink } from "../src/lib/video/consulta.ts";

test("extrai a sala de uma URL do Daily", () => {
  assert.equal(salaDoLink("https://kaiohealth.daily.co/consulta-1a2b3c"), "consulta-1a2b3c");
  assert.equal(salaDoLink("consulta-abc-123"), "consulta-abc-123");
});

test("recusa salas que o app não gera e hosts que não são do Daily", () => {
  assert.equal(salaDoLink("https://kaiohealth.daily.co/outra-sala"), null);
  assert.equal(salaDoLink("https://evil.example/consulta-1"), null);
  assert.equal(salaDoLink("https://kaiohealth.daily.co/consulta-" + "a".repeat(40)), null);
  assert.equal(salaDoLink(""), null);
});

test("monta o link do app e mantém o original quando não reconhece", () => {
  assert.equal(
    linkConsultaPaciente("https://app.exemplo.com/", "https://kaiohealth.daily.co/consulta-9f"),
    "https://app.exemplo.com/consulta/consulta-9f",
  );
  assert.equal(
    linkConsultaPaciente("https://app.exemplo.com", "https://meet.exemplo.com/sala"),
    "https://meet.exemplo.com/sala",
  );
});
