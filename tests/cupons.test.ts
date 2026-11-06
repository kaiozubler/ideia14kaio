// Cupons de desconto: validação do que o CRM manda e cálculo na contratação.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CupomCompletoSchema,
  CupomNovoSchema,
  CupomPatchSchema,
  aplicarCupom,
  type Cupom,
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
