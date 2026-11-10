// Link público de agendamento: só horários da clínica e livres para o médico.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calcularHorariosLivres,
  confirmacaoTrocaValida,
  cpfValido,
  especialidadePublica,
  nomeValido,
  observacoesValidas,
  statusLiberaHorario,
  telefoneValido,
  type GradeSemanal,
} from "../src/lib/agendamento/disponibilidade.ts";

// Segunda-feira, 02/11/2026, 07:00 em Brasília.
const AGORA = Date.parse("2026-11-02T10:00:00Z");
const CLINICA: GradeSemanal = {
  "1": [
    { ini: "08:00", fim: "12:00" },
    { ini: "13:00", fim: "15:00" },
  ],
};
const base = {
  clinica: CLINICA,
  medico: null,
  duracaoMin: 60,
  ocupados: [],
  agoraMs: AGORA,
  antecedenciaHoras: 0,
  janelaDias: 0,
};
const horas = (args: Parameters<typeof calcularHorariosLivres>[0]) =>
  calcularHorariosLivres(args).flatMap((d) => d.horarios.map((h) => h.hora));

test("sem grade do médico oferece o funcionamento da clínica, pulando o intervalo", () => {
  assert.deepEqual(horas(base), ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00"]);
});

test("a grade do médico nunca amplia o horário da clínica", () => {
  const medico = {
    "1": [
      { ini: "06:00", fim: "10:00" },
      { ini: "14:00", fim: "20:00" },
    ],
  };
  assert.deepEqual(horas({ ...base, medico }), ["08:00", "09:00", "14:00"]);
});

test("médico sem faixa no dia não oferece horário", () => {
  assert.deepEqual(horas({ ...base, medico: { "2": [{ ini: "08:00", fim: "12:00" }] } }), []);
});

test("dia em que a clínica fecha não oferece horário mesmo com grade do médico", () => {
  const medico = { "0": [{ ini: "08:00", fim: "12:00" }] };
  const domingoAgora = Date.parse("2026-11-01T10:00:00Z");
  assert.deepEqual(horas({ ...base, medico, agoraMs: domingoAgora }), []);
});

test("consulta marcada tira todo horário que encosta nela", () => {
  const ocupados = [{ inicio: "2026-11-02T12:30:00Z", duracaoMin: 30 }]; // 09:30 em Brasília
  assert.deepEqual(horas({ ...base, ocupados }), ["08:00", "10:00", "11:00", "13:00", "14:00"]);
});

test("consulta que termina no início do horário não o bloqueia", () => {
  const ocupados = [{ inicio: "2026-11-02T11:00:00Z", duracaoMin: 60 }]; // 08:00–09:00
  assert.equal(horas({ ...base, ocupados })[0], "09:00");
});

test("a última consulta precisa caber inteira na faixa", () => {
  assert.deepEqual(horas({ ...base, duracaoMin: 90 }), ["08:00", "09:30", "13:00"]);
});

test("antecedência esconde horários próximos", () => {
  assert.equal(horas({ ...base, antecedenciaHoras: 4 })[0], "11:00");
});

test("o dia e a hora seguem Brasília com o servidor em UTC", () => {
  // 01h UTC de segunda ainda é domingo à noite em Brasília.
  const agora = Date.parse("2026-11-02T01:00:00Z");
  const dias = calcularHorariosLivres({ ...base, agoraMs: agora, janelaDias: 1 });
  assert.equal(dias[0].data, "2026-11-02");
  assert.equal(dias[0].horarios[0].inicio, "2026-11-02T11:00:00.000Z");
});

test("janela limita os dias oferecidos", () => {
  const dias = calcularHorariosLivres({ ...base, janelaDias: 7 });
  assert.deepEqual(
    dias.map((d) => d.data),
    ["2026-11-02", "2026-11-09"],
  );
});

test("grade com lixo é ignorada em vez de quebrar a página", () => {
  const clinica = {
    "1": [{ ini: "25:00", fim: "26:00" }, { ini: "12:00", fim: "08:00" }, null],
  } as unknown as GradeSemanal;
  assert.deepEqual(horas({ ...base, clinica }), []);
});

test("somente cancelado e reagendado liberam o horário", () => {
  assert.equal(statusLiberaHorario("cancelado"), true);
  assert.equal(statusLiberaHorario("Reagendado"), true);
  for (const s of ["agendado", "confirmado", "confirmacao_enviada", "faltou", null]) {
    assert.equal(statusLiberaHorario(s), false, String(s));
  }
});

test("CPF com dígito verificador errado é recusado", () => {
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("52998224726"), false);
  assert.equal(cpfValido("111.111.111-11"), false);
  assert.equal(cpfValido("123"), false);
});

test("especialidade só aparece junto do RQE", () => {
  assert.equal(especialidadePublica("Cardiologia", "1234"), "Cardiologia · RQE 1234");
  assert.equal(especialidadePublica("Cardiologia", " "), null);
  assert.equal(especialidadePublica(null, "1234"), null);
});

test("nome e telefone não aceitam marcação, pois vão para telas que montam HTML", () => {
  assert.equal(nomeValido("Ana D'Ávila-Souza Jr."), true);
  assert.equal(nomeValido("<img src=x onerror=alert(1)>"), false);
  assert.equal(nomeValido("Ana <b>"), false);
  assert.equal(nomeValido("Jo"), false);
  assert.equal(telefoneValido("(31) 99999-9999"), true);
  assert.equal(telefoneValido("+55 31 99999-9999"), true);
  assert.equal(telefoneValido("<b>31999999999</b>"), false);
  assert.equal(telefoneValido("123"), false);
});

test("observações são opcionais, limitadas e sem marcação", () => {
  assert.equal(observacoesValidas(undefined), true);
  assert.equal(observacoesValidas(""), true);
  assert.equal(observacoesValidas("Retorno para mostrar exames de sangue."), true);
  assert.equal(observacoesValidas("a".repeat(500)), true);
  assert.equal(observacoesValidas("a".repeat(501)), false);
  assert.equal(observacoesValidas("<script>alert(1)</script>"), false);
});

test("trocar o link exige a frase exata", () => {
  assert.equal(confirmacaoTrocaValida("TROCAR LINK"), true);
  assert.equal(confirmacaoTrocaValida("  trocar link "), true);
  assert.equal(confirmacaoTrocaValida("trocar"), false);
  assert.equal(confirmacaoTrocaValida(""), false);
  assert.equal(confirmacaoTrocaValida(undefined), false);
});
