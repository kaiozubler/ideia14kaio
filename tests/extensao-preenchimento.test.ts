// Preenchimento de tela pela extensão: saneamento do que a IA devolve.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  campoPermitido,
  cpfValido,
  cpfsNoTexto,
  dadosDoMedico,
  sanearSugestoes,
  type Campo,
} from "../src/lib/extensao/preenchimento.ts";

const campos: Campo[] = [
  { id: "0:c0", rotulo: "Nome do paciente", tipo: "text", valor_atual: "" },
  {
    id: "0:c1",
    rotulo: "Sexo",
    tipo: "select",
    opcoes: ["Selecione", "Feminino", "Masculino"],
    valor_atual: "Selecione",
  },
  { id: "0:c2", rotulo: "Nascimento", tipo: "date", valor_atual: "" },
  { id: "0:c3", rotulo: "Gestante", tipo: "checkbox", valor_atual: "false" },
  { id: "0:c4", rotulo: "Número do cartão", tipo: "text", valor_atual: "" },
  { id: "3:c0", rotulo: "Queixa", tipo: "textarea", valor_atual: "Dor" },
];

test("aceita só ids conhecidos, opções válidas e formatos corretos", () => {
  const resposta =
    "```json\n" +
    JSON.stringify({
      preenchimentos: [
        { id: "0:c0", valor: "Maria Souza", origem: "paciente" },
        { id: "0:c1", valor: "feminino", origem: "paciente" },
        { id: "0:c2", valor: "05/03/1980", origem: "paciente" },
        { id: "0:c3", valor: "não", origem: "conversa" },
        { id: "0:c4", valor: "4111111111111111" },
        { id: "9:c9", valor: "inventado" },
        { id: "0:c0", valor: "Duplicado" },
        { id: "3:c0", valor: "Dor" },
      ],
    }) +
    "\n```";
  assert.deepEqual(sanearSugestoes(resposta, campos), [
    { id: "0:c0", valor: "Maria Souza", origem: "paciente" },
    { id: "0:c1", valor: "Feminino", origem: "paciente" },
    { id: "0:c2", valor: "1980-03-05", origem: "paciente" },
  ]);
});

test("opção inexistente e resposta inválida não viram sugestão", () => {
  assert.deepEqual(
    sanearSugestoes('{"preenchimentos":[{"id":"0:c1","valor":"Outro"}]}', campos),
    [],
  );
  assert.deepEqual(sanearSugestoes("não sei", campos), []);
});

test("campos de credencial e pagamento são bloqueados", () => {
  assert.equal(campoPermitido({ rotulo: "Senha", tipo: "text" }), false);
  assert.equal(campoPermitido({ rotulo: "CVV", tipo: "text" }), false);
  assert.equal(campoPermitido({ rotulo: "Qualquer", tipo: "password" }), false);
  assert.equal(campoPermitido({ rotulo: "Cartão SUS", tipo: "text" }), true);
  assert.equal(campoPermitido({ rotulo: "Número da carteirinha do convênio", tipo: "text" }), true);
  assert.equal(campoPermitido({ rotulo: "Cartão de crédito", tipo: "text" }), false);
  assert.equal(campoPermitido({ rotulo: "Hipótese diagnóstica", tipo: "textarea" }), true);
});

test("CPF só é usado quando os dígitos verificadores batem", () => {
  assert.equal(cpfValido("52998224725"), true);
  assert.equal(cpfValido("11111111111"), false);
  assert.deepEqual(cpfsNoTexto("CPF: 529.982.247-25 tel 11987654321 e 123.456.789-00"), [
    "52998224725",
  ]);
});

test("especialidade do médico só vai junto com o RQE", () => {
  assert.equal(
    dadosDoMedico({ full_name: "Dra. Ana", especialidade: "Cardiologia" }, null).especialidade,
    undefined,
  );
  const com = dadosDoMedico(
    {
      full_name: "Dra. Ana",
      crm_numero: "1234",
      crm_uf: "SP",
      especialidade: "Cardiologia",
      rqe: "99",
    },
    "a@b.com",
  );
  assert.equal(com.especialidade, "Cardiologia");
  assert.equal(com.crm, "1234");
});
