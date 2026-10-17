// Ponte do Zubler CRM: autenticação, bloqueio da clínica e estorno.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alterarStatusPagamento,
  definirAcessoClinica,
  tokenCrmValido,
  type RepoAcessos,
  type RepoPagamentos,
  type StatusPagamento,
} from "../src/lib/crm/ponte.ts";
import { rotaCrm } from "../src/lib/crm/rota.server.ts";

const SEGREDO = "segredo-de-teste-123";

function pedir(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://app.test/api/public/crm/clinicas", { headers });
}

test("token ausente ou errado responde 401 sem chegar aos dados", async () => {
  process.env.CRM_BRIDGE_TOKEN = SEGREDO;
  let chamou = false;
  const rota = rotaCrm(async () => {
    chamou = true;
    return { ok: true };
  });

  for (const auth of [
    undefined,
    "",
    "Bearer",
    "Bearer ",
    "Bearer errado",
    `Basic ${SEGREDO}`,
    `Bearer ${SEGREDO}x`,
  ]) {
    const res = await rota({ request: pedir(auth) });
    assert.equal(res.status, 401, `authorization=${auth}`);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  }
  assert.equal(chamou, false);
});

test("sem CRM_BRIDGE_TOKEN configurado a ponte fica fechada", async () => {
  delete process.env.CRM_BRIDGE_TOKEN;
  const rota = rotaCrm(async () => ({ ok: true }));
  const res = await rota({ request: pedir("Bearer ") });
  assert.equal(res.status, 401);
  assert.equal(await tokenCrmValido("Bearer qualquer", undefined), false);
  assert.equal(await tokenCrmValido("Bearer ", ""), false);
});

test("token certo é aceito", async () => {
  assert.equal(await tokenCrmValido(`Bearer ${SEGREDO}`, SEGREDO), true);
});

function repoAcessosEmMemoria(membros: Record<string, string[]>) {
  const bloqueados = new Map<string, { motivo: string | null; por: string }>();
  const repo: RepoAcessos = {
    async membrosDaClinica(id) {
      return membros[id] ?? [];
    },
    async bloquear(ids, motivo, por) {
      for (const id of ids) bloqueados.set(id, { motivo, por });
    },
    async liberar(ids) {
      for (const id of ids) bloqueados.delete(id);
    },
  };
  return { repo, bloqueados };
}

test("bloquear a clínica bloqueia o médico e todos os membros; liberar libera todos", async () => {
  const { repo, bloqueados } = repoAcessosEmMemoria({
    medico: ["secretaria", "enfermeiro"],
    outra: ["membro-de-outra"],
  });

  const afetados = await definirAcessoClinica(repo, "medico", true, "inadimplência", "ana@zubler");
  assert.deepEqual(afetados.sort(), ["enfermeiro", "medico", "secretaria"]);
  assert.deepEqual([...bloqueados.keys()].sort(), ["enfermeiro", "medico", "secretaria"]);
  assert.deepEqual(bloqueados.get("secretaria"), { motivo: "inadimplência", por: "ana@zubler" });
  assert.equal(bloqueados.has("membro-de-outra"), false);

  await definirAcessoClinica(repo, "medico", false, null, "ana@zubler");
  assert.equal(bloqueados.size, 0);
});

function repoPagamentosEmMemoria() {
  const pagamentos = new Map<
    string,
    { id: string; medico_id: string; status: StatusPagamento; estorno_motivo: string | null }
  >();
  const reativadas: string[] = [];
  const repo: RepoPagamentos = {
    async buscar(id) {
      return pagamentos.get(id) ?? null;
    },
    async atualizarStatus(id, status, estornoMotivo) {
      const p = pagamentos.get(id)!;
      pagamentos.set(id, { ...p, status, estorno_motivo: estornoMotivo });
    },
    async reativarSeInadimplente(medicoId) {
      reativadas.push(medicoId);
    },
  };
  return { repo, pagamentos, reativadas };
}

test("estorno não apaga o pagamento: só muda o status e guarda o motivo", async () => {
  const { repo, pagamentos } = repoPagamentosEmMemoria();
  pagamentos.set("p1", {
    id: "p1",
    medico_id: "medico",
    status: "confirmado",
    estorno_motivo: null,
  });

  await alterarStatusPagamento(repo, "p1", "estornado", "pix devolvido");

  assert.equal(pagamentos.size, 1);
  assert.deepEqual(pagamentos.get("p1"), {
    id: "p1",
    medico_id: "medico",
    status: "estornado",
    estorno_motivo: "pix devolvido",
  });
});

test("confirmar pagamento tira a clínica da inadimplência; estornado não volta a confirmado", async () => {
  const { repo, pagamentos, reativadas } = repoPagamentosEmMemoria();
  pagamentos.set("p1", { id: "p1", medico_id: "medico", status: "pendente", estorno_motivo: null });
  pagamentos.set("p2", { id: "p2", medico_id: "medico", status: "estornado", estorno_motivo: "x" });

  await alterarStatusPagamento(repo, "p1", "confirmado", null);
  assert.equal(pagamentos.get("p1")!.status, "confirmado");
  assert.deepEqual(reativadas, ["medico"]);

  await assert.rejects(alterarStatusPagamento(repo, "p2", "confirmado", null), { status: 409 });
  await assert.rejects(alterarStatusPagamento(repo, "nao-existe", "estornado", null), {
    status: 404,
  });
});
