// Ponte do Zubler CRM, financeiro (contrato v2): status, estorno e cancelamento.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CancelarAssinaturaSchema,
  ErroCrm,
  PagamentoIdSchema,
  planoDeCancelamento,
  statusDaCobranca,
  valorDoEstorno,
} from "../src/lib/crm/ponte.ts";

test("status do Asaas vira português e considera o estornado", () => {
  assert.equal(statusDaCobranca("RECEIVED", 389, 0), "recebido");
  assert.equal(statusDaCobranca("OVERDUE", 389, 0), "vencido");
  assert.equal(statusDaCobranca("DELETED", 389, 0), "cancelado");
  assert.equal(statusDaCobranca("RECEIVED", 389, 100), "estorno_parcial");
  assert.equal(statusDaCobranca("RECEIVED", 389, 389), "estorno_solicitado");
  assert.equal(statusDaCobranca("REFUNDED", 389, 389), "estornado");
  assert.equal(statusDaCobranca("confirmado", 100, 0), "confirmado");
  assert.equal(statusDaCobranca(null, null, 0), "pendente");
});

test("estorno: total por padrão, parcial dentro do que resta", () => {
  assert.deepEqual(valorDoEstorno({ valor: 389, estornado: 0, status: "recebido" }, undefined), {
    valor: 389,
    total: true,
  });
  assert.deepEqual(valorDoEstorno({ valor: 389, estornado: 100, status: "estorno_parcial" }, 50), {
    valor: 50,
    total: false,
  });
  assert.deepEqual(
    valorDoEstorno({ valor: 389.9, estornado: 100.1, status: "estorno_parcial" }, 289.8),
    { valor: 289.8, total: true },
  );
});

test("estorno: recusa valor acima do restante, pagamento em aberto e já estornado", () => {
  const codigo = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof ErroCrm);
      return e.status;
    }
    assert.fail("devia falhar");
  };
  assert.equal(
    codigo(() => valorDoEstorno({ valor: 389, estornado: 100, status: "estorno_parcial" }, 290)),
    400,
  );
  assert.equal(
    codigo(() => valorDoEstorno({ valor: 389, estornado: 0, status: "pendente" }, 10)),
    409,
  );
  assert.equal(
    codigo(() => valorDoEstorno({ valor: 389, estornado: 389, status: "confirmado" }, undefined)),
    409,
  );
});

test("cancelamento no fim do ciclo: endDate no dia anterior à próxima cobrança", () => {
  const plano = planoDeCancelamento(
    { status: "ativa", proxima_cobranca: "2026-12-01", cancelamento_agendado_para: null },
    "fim_do_ciclo",
    "2026-11-11",
  );
  assert.deepEqual(plano, { imediato: false, agendadoPara: "2026-12-01", endDate: "2026-11-30" });
});

test("cancelamento: regras de quando dá para agendar", () => {
  const status = (
    a: Parameters<typeof planoDeCancelamento>[0],
    quando: "agora" | "fim_do_ciclo",
  ) => {
    try {
      planoDeCancelamento(a, quando, "2026-11-11");
      return 200;
    } catch (e) {
      return (e as ErroCrm).status;
    }
  };
  const ativa = {
    status: "ativa",
    proxima_cobranca: "2026-12-01",
    cancelamento_agendado_para: null,
  };
  assert.equal(status({ ...ativa, status: "cancelada" }, "agora"), 409);
  assert.equal(status({ ...ativa, status: "inadimplente" }, "fim_do_ciclo"), 409);
  assert.equal(status({ ...ativa, status: "inadimplente" }, "agora"), 200);
  assert.equal(status({ ...ativa, proxima_cobranca: "2026-11-11" }, "fim_do_ciclo"), 409);
  assert.equal(status({ ...ativa, cancelamento_agendado_para: "2026-12-01" }, "fim_do_ciclo"), 409);
  assert.equal(status({ ...ativa, cancelamento_agendado_para: "2026-12-01" }, "agora"), 200);
});

test("ids e corpo das rotas novas", () => {
  assert.ok(PagamentoIdSchema.safeParse("pay_080225913252").success);
  assert.ok(PagamentoIdSchema.safeParse("3f1c2b4a-1d2e-4f5a-9b8c-7d6e5f4a3b2c").success);
  assert.ok(!PagamentoIdSchema.safeParse("pay_../../x").success);
  assert.ok(!PagamentoIdSchema.safeParse("cus_123").success);
  const c = CancelarAssinaturaSchema.parse({ quando: "agora", motivo: "Preço" });
  assert.equal(c.cancelar_pendentes, false);
  assert.ok(!CancelarAssinaturaSchema.safeParse({ quando: "ontem" }).success);
});
