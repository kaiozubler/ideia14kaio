// Pipe do Zubler CRM: posição automática, posição salva e health score.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PipePatchSchema,
  engajamento,
  healthScore,
  posicaoAutomaticaClinica,
  posicaoAutomaticaContratacao,
  posicaoFinal,
} from "../src/lib/crm/pipe.ts";

const AGORA = Date.parse("2026-11-11T12:00:00Z");

test("clínica sem assinatura é lead em cadastro; cancelada também volta para lead", () => {
  assert.deepEqual(posicaoAutomaticaClinica({ assinatura: null, assinatura_desde: null }, AGORA), {
    funil: "leads",
    etapa: "cadastro",
  });
  assert.deepEqual(
    posicaoAutomaticaClinica({ assinatura: "cancelada", assinatura_desde: "2026-01-01" }, AGORA),
    { funil: "leads", etapa: "cadastro" },
  );
});

test("assinatura nova vai para onboarding, antiga para ongoing e inadimplente para risco", () => {
  assert.deepEqual(
    posicaoAutomaticaClinica({ assinatura: "ativa", assinatura_desde: "2026-11-01" }, AGORA),
    { funil: "onboarding", etapa: "kickoff" },
  );
  assert.deepEqual(
    posicaoAutomaticaClinica({ assinatura: "ativa", assinatura_desde: "2026-08-01" }, AGORA),
    { funil: "ongoing", etapa: "customer-success" },
  );
  assert.deepEqual(
    posicaoAutomaticaClinica({ assinatura: "inadimplente", assinatura_desde: "2026-11-01" }, AGORA),
    { funil: "ongoing", etapa: "risco" },
  );
});

test("contratação segue o status do fluxo de compra", () => {
  assert.equal(
    posicaoAutomaticaContratacao({ status: "em_andamento", pago: false }).etapa,
    "contratando",
  );
  assert.equal(
    posicaoAutomaticaContratacao({ status: "aguardando_confirmacao", pago: false }).etapa,
    "aguardando-pagamento",
  );
  assert.equal(posicaoAutomaticaContratacao({ status: "confirmada", pago: true }).etapa, "pago");
});

test("posição salva vale só enquanto combina com a fase do cliente", () => {
  const auto = { funil: "onboarding" as const, etapa: "kickoff" };
  assert.deepEqual(posicaoFinal("cliente", auto, { funil: "ongoing", etapa: "expansao" }), {
    funil: "ongoing",
    etapa: "expansao",
  });
  // Lead que assinou sai do funil de leads sozinho.
  assert.equal(posicaoFinal("cliente", auto, { funil: "leads", etapa: "pago" }), auto);
  // Cliente que cancelou não fica preso no ongoing.
  const autoLead = { funil: "leads" as const, etapa: "cadastro" };
  assert.equal(posicaoFinal("lead", autoLead, { funil: "ongoing", etapa: "sucesso" }), autoLead);
  // Etapa que não existe mais cai na automática.
  assert.equal(posicaoFinal("cliente", auto, { funil: "ongoing", etapa: "sumiu" }), auto);
  assert.equal(posicaoFinal("cliente", auto, null), auto);
});

test("health score cai com inatividade, inadimplência, vencidas e bloqueio", () => {
  const base = {
    dias_sem_login: 1,
    inadimplente: false,
    cobrancas_vencidas: 0,
    acesso_bloqueado: false,
    membros: 0,
  };
  assert.equal(healthScore(base), 100);
  assert.ok(
    healthScore({ ...base, dias_sem_login: 45 }) < healthScore({ ...base, dias_sem_login: 10 }),
  );
  assert.ok(healthScore({ ...base, inadimplente: true }) <= 65);
  assert.equal(
    healthScore({
      ...base,
      dias_sem_login: null,
      inadimplente: true,
      cobrancas_vencidas: 5,
      acesso_bloqueado: true,
    }),
    0,
  );
  assert.equal(engajamento(3), "engaged");
  assert.equal(engajamento(20), "warm");
  assert.equal(engajamento(null), "cold");
});

test("gravação exige funil e etapa válidos juntos e algo para salvar", () => {
  assert.ok(
    PipePatchSchema.safeParse({ tipo: "clinica", funil: "ongoing", etapa: "risco" }).success,
  );
  assert.ok(
    PipePatchSchema.safeParse({ tipo: "contratacao", responsavel: "ana@zubler.com.br" }).success,
  );
  assert.ok(
    PipePatchSchema.safeParse({ tipo: "clinica", lost: { reason: "Preço", date: "2026-11-10" } })
      .success,
  );
  assert.ok(!PipePatchSchema.safeParse({ tipo: "clinica", funil: "ongoing" }).success);
  assert.ok(
    !PipePatchSchema.safeParse({ tipo: "clinica", funil: "leads", etapa: "risco" }).success,
  );
  assert.ok(!PipePatchSchema.safeParse({ tipo: "clinica" }).success);
  assert.ok(!PipePatchSchema.safeParse({ tipo: "outro", responsavel: null }).success);
});
