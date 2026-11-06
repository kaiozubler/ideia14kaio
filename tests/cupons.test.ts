// Cupons de desconto: validação do que o CRM manda e cálculo na contratação.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CupomCompletoSchema,
  CupomNovoSchema,
  CupomPatchSchema,
  aplicarCupom,
  bonusVigente,
  primeiraCobrancaEm,
  semCobranca,
  textoDoCupom,
  valorDaCobrancaComCupom,
  type Cupom,
  type CupomAplicado,
} from "../src/lib/cupons/regras.ts";

const base = { tipo: "percentual", valor: 20 };
const erro = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error!.issues[0].message;

test("nome vira código maiúsculo e só aceita letras, números, - e _", () => {
  const r = CupomNovoSchema.parse({ ...base, codigo: "  pro20 " });
  assert.equal(r.codigo, "PRO20");
  assert.deepEqual(r.planos, []);
  assert.equal(r.ativo, true);
  assert.ok(!CupomNovoSchema.safeParse({ ...base, codigo: "PRO 20" }).success);
  assert.ok(!CupomNovoSchema.safeParse({ ...base, codigo: "AB" }).success);
});

test("regras por tipo", () => {
  const ok = (c: object) => CupomNovoSchema.safeParse({ codigo: "TESTE", ...c });
  assert.match(erro(ok({ tipo: "percentual", valor: 120 }))!, /até 100%/);
  assert.ok(ok({ tipo: "percentual", valor: 100, duracao_meses: 3 }).success);
  assert.match(erro(ok({ tipo: "teste_gratis", valor: 30, duracao_meses: 2 }))!, /dias/);
  assert.match(erro(ok({ tipo: "teste_gratis", valor: 7.5 }))!, /1 a 365/);
  assert.match(erro(ok({ tipo: "recurso_adicional", valor: 5000 }))!, /escolha o recurso/);
  assert.ok(ok({ tipo: "recurso_adicional", valor: 5000, recurso: "whatsapp" }).success);
  assert.match(erro(ok({ tipo: "valor", valor: 10, recurso: "whatsapp" }))!, /recurso adicional/);
  assert.match(
    erro(ok({ tipo: "recurso_adicional", valor: 1, recurso: "copiloto_ativo", planos: ["pro"] }))!,
    /Enterprise/,
  );
  assert.match(
    erro(ok({ ...base, valido_de: "2026-12-01", valido_ate: "2026-11-01" }))!,
    /antes do início/,
  );
  assert.ok(!ok({ ...base, planos: ["gold"] }).success);
});

test("edição não troca o nome e revalida o cupom inteiro", () => {
  assert.ok(!CupomPatchSchema.safeParse({ codigo: "OUTRO" }).success);
  assert.ok(!CupomPatchSchema.safeParse({}).success);
  assert.ok(CupomPatchSchema.safeParse({ ativo: false }).success);
  // salvo como 50% → trocar só o tipo para teste_gratis com duração salva quebra
  const salvo = { tipo: "percentual", valor: 50, planos: [], duracao_meses: 3, ativo: true };
  assert.ok(!CupomCompletoSchema.safeParse({ ...salvo, tipo: "teste_gratis" }).success);
});

const cupom = (c: Partial<Cupom>): Cupom => ({
  codigo: "X",
  tipo: "percentual",
  valor: 20,
  planos: [],
  ativo: true,
  ...c,
});
const pedidoPro = { plano: "pro", ciclo: "mensal" as const, precoMensal: 249.9 };
const agora = new Date("2026-11-06T12:00:00Z");

test("20% no Pro por 3 meses", () => {
  const r = aplicarCupom(cupom({ planos: ["pro"], duracao_meses: 3 }), pedidoPro, { agora });
  assert.ok(r.ok);
  assert.equal(r.descontoMensal, 49.98);
  assert.equal(r.precoMensalComDesconto, 199.92);
  assert.equal(r.meses, 3);
  assert.equal(r.bonificado, false);
  const basic = aplicarCupom(
    cupom({ planos: ["pro"] }),
    { ...pedidoPro, plano: "basic" },
    { agora },
  );
  assert.deepEqual(basic, { ok: false, motivo: "Este cupom vale só para o plano Pro." });
});

test("desconto total vira bonificação e valor nunca fica negativo", () => {
  const r = aplicarCupom(cupom({ tipo: "valor", valor: 500 }), pedidoPro, { agora });
  assert.ok(r.ok && r.precoMensalComDesconto === 0 && r.bonificado && r.meses === null);
  const p = aplicarCupom(cupom({ valor: 100 }), pedidoPro, { agora });
  assert.ok(p.ok && p.bonificado);
});

test("teste grátis e recurso adicional não mexem na mensalidade", () => {
  const t = aplicarCupom(cupom({ tipo: "teste_gratis", valor: 30 }), pedidoPro, { agora });
  assert.ok(t.ok && t.diasTeste === 30 && t.precoMensalComDesconto === 249.9);
  const w = aplicarCupom(
    cupom({ tipo: "recurso_adicional", valor: 5000, recurso: "whatsapp" }),
    pedidoPro,
    { agora },
  );
  assert.ok(w.ok);
  assert.deepEqual(w.bonus, { recurso: "whatsapp", quantidade: 5000 });
});

test("inativo, fora da validade, esgotado e ciclo errado não valem", () => {
  const motivo = (c: Partial<Cupom>, usos = 0) => {
    const r = aplicarCupom(cupom(c), pedidoPro, { agora, usos });
    return r.ok ? null : r.motivo;
  };
  assert.match(motivo({ ativo: false })!, /ativo/);
  assert.match(motivo({ valido_de: "2026-11-07" })!, /ainda não/);
  assert.match(motivo({ valido_ate: "2026-11-05" })!, /expirou/);
  assert.equal(motivo({ valido_de: "2026-11-06", valido_ate: "2026-11-06" }), null);
  assert.match(motivo({ limite_usos: 10 }, 10)!, /limite/);
  assert.match(motivo({ ciclo: "anual" })!, /anual/);
});

// ---------------------------------------------------------------------------
// Cobrança recorrente com o cupom
// ---------------------------------------------------------------------------

function aplicado(c: Partial<Cupom>, ciclo: "mensal" | "anual" = "mensal"): CupomAplicado {
  const r = aplicarCupom(cupom(c), { ...pedidoPro, ciclo }, { agora });
  assert.ok(r.ok);
  return { ...r, codigo: "X" };
}

test("desconto por 3 meses: 3 mensalidades com desconto, depois preço cheio", () => {
  const c = aplicado({ duracao_meses: 3 });
  const valores = [0, 1, 2, 3, 4].map((k) => valorDaCobrancaComCupom(c, 249.9, "mensal", k));
  assert.deepEqual(valores, [199.92, 199.92, 199.92, 249.9, 249.9]);
  assert.equal(primeiraCobrancaEm(c, "2026-11-06"), "2026-11-06");
  assert.match(textoDoCupom(c), /^R\$\s49,98 de desconto por mês por 3 meses$/);
});

test("no anual, o desconto dos meses cobertos sai da cobrança do ano", () => {
  const c = aplicado({ duracao_meses: 3 }, "anual");
  // ano cheio: 249,90 × 0,85 × 12 = 2.548,98; 3 meses × 49,98 × 0,85 = 127,45
  assert.equal(valorDaCobrancaComCupom(c, 249.9, "anual", 0), 2421.53);
  assert.equal(valorDaCobrancaComCupom(c, 249.9, "anual", 1), 2548.98);
  const vitalicio = aplicado({}, "anual");
  assert.equal(valorDaCobrancaComCupom(vitalicio, 249.9, "anual", 5), 2039.18);
});

test("100% por N meses adia a primeira cobrança; 100% vitalício não cobra", () => {
  const c = aplicado({ valor: 100, duracao_meses: 2 });
  assert.equal(semCobranca(c), false);
  assert.equal(primeiraCobrancaEm(c, "2026-11-06"), "2027-01-06");
  assert.equal(
    primeiraCobrancaEm(aplicado({ valor: 100, duracao_meses: 1 }), "2027-01-31"),
    "2027-02-28",
  );
  assert.equal(valorDaCobrancaComCupom(c, 249.9, "mensal", 0), 249.9);
  assert.equal(semCobranca(aplicado({ valor: 100 })), true);
});

test("teste grátis adia a primeira cobrança sem mudar o valor", () => {
  const c = aplicado({ tipo: "teste_gratis", valor: 30 });
  assert.equal(primeiraCobrancaEm(c, "2026-11-06"), "2026-12-06");
  assert.equal(valorDaCobrancaComCupom(c, 249.9, "mensal", 0), 249.9);
  assert.equal(semCobranca(c), false);
});

test("recurso extra por 3 meses sai na 4ª mensalidade (ou no 2º ano no anual)", () => {
  const c = aplicado({
    tipo: "recurso_adicional",
    valor: 5000,
    recurso: "whatsapp",
    duracao_meses: 3,
  });
  assert.deepEqual(
    [0, 1, 2, 3].map((k) => bonusVigente(c, "mensal", k)),
    [true, true, true, false],
  );
  assert.deepEqual(
    [0, 1].map((k) => bonusVigente(c, "anual", k)),
    [true, false],
  );
  assert.equal(valorDaCobrancaComCupom(c, 249.9, "mensal", 0), 249.9);
  const sempre = aplicado({ tipo: "recurso_adicional", valor: 5000, recurso: "whatsapp" });
  assert.equal(bonusVigente(sempre, "mensal", 40), true);
});
