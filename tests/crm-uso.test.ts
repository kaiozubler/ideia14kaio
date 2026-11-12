// Insights de uso do Zubler CRM: períodos, comparação e alertas.
// Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calcularUso,
  periodos,
  rankingTelas,
  serieDiaria,
  somarDias,
  type ClinicaUso,
  type DiaAtividade,
  type DiaUsuario,
} from "../src/lib/crm/uso.ts";

const HOJE = "2026-11-12";

function clinica(id: string, extra: Partial<ClinicaUso> = {}): ClinicaUso {
  return {
    id,
    nome: `Clínica ${id}`,
    inicio: "2026-01-01",
    ultimo_login: null,
    assinatura: {
      plano: "pro",
      status: "ativa",
      preco_mensal: 389,
      cancelamento_agendado_para: null,
      medicos: 2,
      secretarias: 2,
    },
    licencas_em_uso: { medicos: 1, secretarias: 1 },
    consumo: [],
    adicionais: [],
    ...extra,
  };
}

/** Um acesso por dia em `n` dias seguidos terminando em `fim`. */
function acessos(
  clinicaId: string,
  fim: string,
  n: number,
  user = `${clinicaId}-u1`,
): DiaUsuario[] {
  return Array.from({ length: n }, (_, i) => ({
    clinica_id: clinicaId,
    user_id: user,
    dia: somarDias(fim, -i),
    acessos: 1,
    telas: 3,
  }));
}
function consultas(clinicaId: string, fim: string, n: number, porDia: number): DiaAtividade[] {
  return Array.from({ length: n }, (_, i) => ({
    clinica_id: clinicaId,
    dia: somarDias(fim, -i),
    consultas: porDia,
    agendamentos: porDia,
    atendimentos_agendados: 0,
    pacientes: 0,
    documentos: 0,
  }));
}

test("períodos: atual termina hoje e os anteriores têm o mesmo tamanho", () => {
  const p = periodos(HOJE, 30, 180);
  assert.deepEqual(p.atual, { inicio: "2026-10-14", fim: HOJE });
  assert.deepEqual(p.anterior, { inicio: "2026-09-14", fim: "2026-10-13" });
  assert.equal(p.anteriores.length, 5);
});

test("queda forte de uso e de consultas vira risco alto, com comparação", () => {
  const anteriorFim = "2026-10-13";
  const usuarios = [
    ...acessos("a", anteriorFim, 20), // 20 dias no período anterior
    ...acessos("a", HOJE, 3), // 3 dias agora
    ...["b", "c", "d"].flatMap((id) => acessos(id, HOJE, 15)),
  ];
  const atividade = [
    ...consultas("a", anteriorFim, 20, 2), // 40 consultas antes
    ...consultas("a", HOJE, 3, 2), // 6 agora
    ...["b", "c", "d"].flatMap((id) => consultas(id, HOJE, 15, 2)),
  ];
  const r = calcularUso({
    hoje: HOJE,
    dias: 30,
    historicoDias: 180,
    clinicas: ["a", "b", "c", "d"].map((id) => clinica(id)),
    usuarios,
    atividade,
  });
  const a = r.clinicas.find((c) => c.clinica_id === "a")!;
  assert.equal(a.metricas.dias_ativos.atual, 3);
  assert.equal(a.metricas.dias_ativos.anterior, 20);
  assert.equal(a.metricas.dias_ativos.variacao, -0.85);
  assert.equal(a.metricas.dias_ativos.media_parceiros, 15);
  assert.equal(a.metricas.dias_ativos.avaliacao, "abaixo");
  assert.equal(a.risco.nivel, "alto");
  const titulos = a.alertas.map((x) => x.titulo);
  assert.ok(titulos.includes("Queda de 85% em dias com acesso"));
  assert.ok(titulos.includes("Queda de 85% em consultas"));
  assert.ok(titulos.includes("Uso abaixo dos parceiros"));
  const b = r.clinicas.find((c) => c.clinica_id === "b")!;
  assert.equal(b.risco.nivel, "baixo");
  assert.equal(b.dias_sem_acesso, 0);
});

test("sem acesso há 20 dias e nunca acessou", () => {
  const r = calcularUso({
    hoje: HOJE,
    dias: 30,
    historicoDias: 180,
    clinicas: [
      clinica("a"),
      clinica("n", { inicio: "2026-11-01" }),
      clinica("novo", { inicio: "2026-11-10" }),
    ],
    usuarios: acessos("a", somarDias(HOJE, -20), 1),
    atividade: [],
  });
  const a = r.clinicas.find((c) => c.clinica_id === "a")!;
  assert.equal(a.dias_sem_acesso, 20);
  assert.ok(a.alertas.some((x) => x.titulo === "Sem acesso há 20 dias" && x.gravidade === "alta"));
  const n = r.clinicas.find((c) => c.clinica_id === "n")!;
  assert.ok(n.alertas.some((x) => x.titulo === "Nunca acessou"));
  // Conta com menos de 7 dias ainda não alerta.
  assert.equal(r.clinicas.find((c) => c.clinica_id === "novo")!.alertas.length, 0);
});

test("sem assinatura não gera alerta de churn nem de upgrade", () => {
  const r = calcularUso({
    hoje: HOJE,
    dias: 30,
    historicoDias: 180,
    clinicas: [clinica("free", { assinatura: null })],
    usuarios: [],
    atividade: [],
  });
  assert.equal(r.alertas.length, 0);
});

test("upgrade: franquia perto do limite, ultrapassada, adicionais e licenças", () => {
  const r = calcularUso({
    hoje: HOJE,
    dias: 30,
    historicoDias: 180,
    clinicas: [
      clinica("a", {
        consumo: [
          { recurso: "copiloto", franquia: 100, usado: 85, saldo_adicional: 0 },
          { recurso: "whatsapp", franquia: 500, usado: 520, saldo_adicional: 0 },
          { recurso: "video", franquia: 0, usado: 0, saldo_adicional: 0 },
        ],
        adicionais: [{ recurso: "copiloto", quantidade: 50, data: "2026-10-20", valor: 15 }],
        licencas_em_uso: { medicos: 2, secretarias: 0 },
      }),
    ],
    usuarios: acessos("a", HOJE, 10),
    atividade: [],
  });
  const t = r.alertas.filter((x) => x.tipo === "upgrade").map((x) => x.titulo);
  assert.deepEqual(t.sort(), [
    "Comprou adicionais",
    "Perto do limite de Copiloto",
    "Todas as licenças de médico em uso",
    "Ultrapassou a franquia de WhatsApp",
  ]);
  assert.equal(r.clinicas[0].consumo[0].uso, 0.85);
});

test("média histórica ignora períodos antes da conta existir", () => {
  const r = calcularUso({
    hoje: HOJE,
    dias: 30,
    historicoDias: 180,
    clinicas: [clinica("a", { inicio: "2026-09-01" })],
    usuarios: [],
    atividade: consultas("a", "2026-10-13", 30, 1),
  });
  // Só o período anterior (14/09 a 13/10) está inteiro depois de 01/09.
  assert.equal(r.clinicas[0].metricas.consultas.media_historica, 30);
});

test("série diária e ranking de telas", () => {
  const s = serieDiaria(
    acessos("a", HOJE, 2),
    consultas("a", HOJE, 1, 4),
    somarDias(HOJE, -2),
    HOJE,
  );
  assert.deepEqual(
    s.map((d) => [d.acessos, d.usuarios, d.consultas]),
    [
      [0, 0, 0],
      [1, 1, 0],
      [1, 1, 4],
    ],
  );
  const p = periodos(HOJE, 7, 180);
  const t = rankingTelas(
    [
      { clinica_id: "a", tela: "agenda", dia: HOJE, eventos: 10, usuarios: 1 },
      { clinica_id: "b", tela: "agenda", dia: HOJE, eventos: 5, usuarios: 1 },
      { clinica_id: "a", tela: "agenda", dia: somarDias(HOJE, -8), eventos: 30, usuarios: 1 },
      { clinica_id: "a", tela: "patients", dia: HOJE, eventos: 3, usuarios: 1 },
    ],
    p.atual,
    p.anterior,
  );
  assert.deepEqual(t[0], {
    tela: "agenda",
    eventos: 15,
    anterior: 30,
    variacao: -0.5,
    clinicas: 2,
    dias: 1,
  });
  assert.equal(t[1].tela, "patients");
});
