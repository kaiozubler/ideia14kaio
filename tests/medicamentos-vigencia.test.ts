// Vigência dos medicamentos prescritos: data limite da receita e o que as IAs
// recebem como "em uso hoje" × "encerrado". Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { dataHojeBrasilia, hojeISOBrasilia, regrasTemporais } from "../src/lib/ia/temporal.ts";

// Script de navegador (sem export): registra-se em globalThis.MedVigencia.
await import("../public/medicamentos-vigencia.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MV = (globalThis as any).MedVigencia;

test("data limite conta o dia de início como 1º dia de uso", () => {
  assert.equal(MV.dataFim("2026-11-27", "dias", 7), "2026-12-03");
  assert.equal(MV.dataFim("2026-11-27", "semanas", "2"), "2026-12-10");
  assert.equal(MV.dataFim("2026-11-27", "meses", 1), "2026-12-26");
  assert.equal(MV.dataFim("2026-11-27", "uso_continuo", ""), null);
  assert.equal(MV.dataFim("2026-11-27", "dias", ""), null);
});

test("duração é obrigatória: valor positivo ou uso contínuo", () => {
  assert.equal(MV.duracaoValida("", ""), false);
  assert.equal(MV.duracaoValida("dias", "0"), false);
  assert.equal(MV.duracaoValida("dias", "5"), true);
  assert.equal(MV.duracaoValida("uso_continuo", ""), true);
});

test("posologia preenche a duração só quando é inequívoca", () => {
  assert.deepEqual(MV.duracaoDaPosologia("1 cp de 8/8h por 7 dias"), { tipo: "dias", valor: "7" });
  assert.deepEqual(MV.duracaoDaPosologia("1 cp à noite durante 2 semanas"), {
    tipo: "semanas",
    valor: "2",
  });
  assert.deepEqual(MV.duracaoDaPosologia("1 cp ao dia por 3 meses"), { tipo: "meses", valor: "3" });
  assert.deepEqual(MV.duracaoDaPosologia("1 cp ao dia, uso contínuo"), {
    tipo: "uso_continuo",
    valor: "",
  });
  assert.equal(MV.duracaoDaPosologia("1 cp se dor"), null);
});

test("tratamento antigo vira histórico e não aparece como em uso", () => {
  const linhas = [
    {
      medicamento_nome: "Dipirona",
      posologia: "1 cp 6/6h",
      uso_continuo: false,
      data_inicio: "2023-03-02",
      data_fim: "2023-03-06",
      ativo: true,
    },
    {
      medicamento_nome: "Losartana",
      uso_continuo: true,
      data_inicio: "2025-01-10",
      data_fim: null,
      ativo: true,
    },
    {
      medicamento_nome: "Amoxicilina",
      uso_continuo: false,
      data_inicio: "2026-11-25",
      data_fim: "2026-12-01",
      ativo: true,
    },
  ];
  const { vigentes, encerrados } = MV.classificar(linhas, "2026-11-27");
  assert.deepEqual(
    vigentes.map((l: { medicamento_nome: string }) => l.medicamento_nome),
    ["Amoxicilina", "Losartana"],
  );
  assert.deepEqual(
    encerrados.map((l: { medicamento_nome: string }) => l.medicamento_nome),
    ["Dipirona"],
  );

  const texto = MV.textoParaIA(linhas, "2026-11-27");
  const [emUso, historico] = texto.split("Tratamentos ENCERRADOS");
  assert.match(emUso, /Data de hoje: 27\/11\/2026/);
  assert.match(emUso, /Amoxicilina — de 25\/11\/2026 até 01\/12\/2026/);
  assert.match(emUso, /Losartana — uso contínuo, prescrito em 10\/01\/2025/);
  assert.doesNotMatch(emUso, /Dipirona/);
  assert.match(
    historico,
    /Dipirona — 1 cp 6\/6h — de 02\/03\/2023 até 06\/03\/2023 \(terminou há 3 anos\)/,
  );
});

test("a prescrição mais recente do mesmo medicamento decide", () => {
  const linhas = [
    {
      medicamento_nome: "Dipirona",
      uso_continuo: false,
      data_inicio: "2023-03-02",
      data_fim: "2023-03-06",
    },
    {
      medicamento_nome: "dipirona ",
      uso_continuo: false,
      data_inicio: "2026-11-26",
      data_fim: "2026-11-30",
    },
  ];
  const { vigentes, encerrados } = MV.classificar(linhas, "2026-11-27");
  assert.equal(vigentes.length, 1);
  assert.equal(encerrados.length, 0);
  assert.equal(MV.textoParaIA([], "2026-11-27"), "");
});

test("data de hoje usa o fuso de Brasília", () => {
  const depoisDas21h = new Date("2026-11-28T01:30:00Z"); // 27/11 22h30 em Brasília
  assert.equal(hojeISOBrasilia(depoisDas21h), "2026-11-27");
  assert.equal(dataHojeBrasilia(depoisDas21h), "27/11/2026");
  assert.match(regrasTemporais("27/11/2026"), /Data de hoje: 27\/11\/2026/);
});
