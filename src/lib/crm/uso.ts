// Insights de uso para o Zubler CRM: métricas por período, comparação com o
// período anterior, com a média histórica da própria clínica e com a média
// dos demais parceiros, e os alertas de risco de churn, queda de uso e
// oportunidade de upgrade. Sem banco, para os testes (tests/crm-uso.test.ts).

export type DiaUsuario = {
  clinica_id: string;
  user_id: string;
  dia: string;
  acessos: number;
  telas: number;
};
export type DiaTela = {
  clinica_id: string;
  tela: string;
  dia: string;
  eventos: number;
  usuarios: number;
};
export type DiaAtividade = {
  clinica_id: string;
  dia: string;
  consultas: number;
  agendamentos: number;
  atendimentos_agendados: number;
  pacientes: number;
  documentos: number;
};

export type Consumo = {
  recurso: string;
  franquia: number;
  usado: number;
  /** créditos adicionais pagos ainda não consumidos */
  saldo_adicional: number;
};
export type Adicional = { recurso: string; quantidade: number; data: string; valor: number | null };

export type ClinicaUso = {
  id: string;
  nome: string | null;
  /** dia (AAAA-MM-DD) em que a conta foi criada */
  inicio: string;
  ultimo_login: string | null;
  assinatura: {
    plano: string;
    status: string;
    preco_mensal: number;
    cancelamento_agendado_para: string | null;
    medicos: number;
    secretarias: number;
  } | null;
  licencas_em_uso: { medicos: number; secretarias: number };
  consumo: Consumo[];
  adicionais: Adicional[];
};

export const METRICAS = [
  "acessos",
  "dias_ativos",
  "usuarios_ativos",
  "telas",
  "consultas",
  "agendamentos",
  "atendimentos_agendados",
  "pacientes",
  "documentos",
] as const;
export type Metrica = (typeof METRICAS)[number];
export type Valores = Record<Metrica, number>;

export type Comparacao = {
  atual: number;
  anterior: number;
  /** -0.4 = caiu 40%; null quando o período anterior foi zero */
  variacao: number | null;
  /** média por período da própria clínica antes do período atual (null sem histórico) */
  media_historica: number | null;
  /** média dos demais parceiros assinantes no período atual (null com menos de 3) */
  media_parceiros: number | null;
  avaliacao: "acima" | "na_media" | "abaixo" | "sem_base";
};

export type Alerta = {
  clinica_id: string;
  clinica_nome: string | null;
  tipo: "churn" | "queda" | "upgrade";
  gravidade: "alta" | "media" | "baixa";
  titulo: string;
  detalhe: string;
};

export type Periodo = { inicio: string; fim: string };

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round(
    (new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000,
  );
}

/** Hoje no horário de Brasília. */
export function hojeBrasilia(agora = new Date()): string {
  return new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Período atual (termina hoje), o anterior e os anteriores a ele dentro do histórico. */
export function periodos(hoje: string, dias: number, historicoDias: number) {
  const atual = { inicio: somarDias(hoje, -(dias - 1)), fim: hoje };
  const anteriores: Periodo[] = [];
  for (let k = 1; (k + 1) * dias <= historicoDias; k++) {
    anteriores.push({
      inicio: somarDias(atual.inicio, -k * dias),
      fim: somarDias(atual.fim, -k * dias),
    });
  }
  return { atual, anterior: anteriores[0] ?? null, anteriores };
}

const dentro = (dia: string, p: Periodo) => dia >= p.inicio && dia <= p.fim;

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

export function valoresVazios(): Valores {
  return Object.fromEntries(METRICAS.map((m) => [m, 0])) as Valores;
}

export function valoresNoPeriodo(
  usuarios: DiaUsuario[],
  atividade: DiaAtividade[],
  p: Periodo,
): Valores {
  const v = valoresVazios();
  const dias = new Set<string>();
  const logins = new Set<string>();
  for (const u of usuarios) {
    if (!dentro(u.dia, p)) continue;
    v.acessos += u.acessos;
    v.telas += u.telas;
    dias.add(u.dia);
    logins.add(u.user_id);
  }
  v.dias_ativos = dias.size;
  v.usuarios_ativos = logins.size;
  for (const a of atividade) {
    if (!dentro(a.dia, p)) continue;
    v.consultas += a.consultas;
    v.agendamentos += a.agendamentos;
    v.atendimentos_agendados += a.atendimentos_agendados;
    v.pacientes += a.pacientes;
    v.documentos += a.documentos;
  }
  return v;
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const arred = (x: number | null, casas = 1) =>
  x == null ? null : Math.round(x * 10 ** casas) / 10 ** casas;

export function avaliar(atual: number, referencia: number | null): Comparacao["avaliacao"] {
  if (referencia == null || referencia <= 0) return "sem_base";
  const r = atual / referencia;
  if (r >= 1.2) return "acima";
  if (r >= 0.8) return "na_media";
  return "abaixo";
}

export function comparar(
  atual: number,
  anterior: number,
  historico: number[],
  parceiros: number[],
): Comparacao {
  const mediaParceiros = parceiros.length >= 3 ? media(parceiros) : null;
  const mediaHistorica = media(historico);
  return {
    atual,
    anterior,
    variacao: anterior > 0 ? arred((atual - anterior) / anterior, 3) : null,
    media_historica: arred(mediaHistorica),
    media_parceiros: arred(mediaParceiros),
    avaliacao: avaliar(atual, mediaParceiros ?? mediaHistorica),
  };
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const assinante = (c: ClinicaUso) =>
  !!c.assinatura && (c.assinatura.status === "ativa" || c.assinatura.status === "inadimplente");

const ROTULO: Partial<Record<Metrica, string>> = {
  dias_ativos: "dias com acesso",
  consultas: "consultas",
  agendamentos: "agendamentos criados",
  acessos: "acessos",
};

/** Pontos de risco de churn (0 a 100) e os alertas que os explicam. */
export function riscoDeChurn(
  c: ClinicaUso,
  comp: Record<Metrica, Comparacao>,
  ultimoAcesso: string | null,
  hoje: string,
  dias: number,
): { pontos: number; nivel: "alto" | "medio" | "baixo"; alertas: Alerta[] } {
  const alertas: Alerta[] = [];
  let pontos = 0;
  const add = (p: number, a: Omit<Alerta, "clinica_id" | "clinica_nome">) => {
    pontos += p;
    alertas.push({ clinica_id: c.id, clinica_nome: c.nome, ...a });
  };
  if (!assinante(c)) return { pontos: 0, nivel: "baixo", alertas };
  const a = c.assinatura!;

  if (a.cancelamento_agendado_para)
    add(30, {
      tipo: "churn",
      gravidade: "alta",
      titulo: "Cancelamento agendado",
      detalhe: `Acesso termina em ${a.cancelamento_agendado_para}.`,
    });
  if (a.status === "inadimplente")
    add(15, {
      tipo: "churn",
      gravidade: "media",
      titulo: "Inadimplente",
      detalhe: "Cobrança em atraso: risco de cancelamento.",
    });

  const ultimo = [ultimoAcesso, c.ultimo_login?.slice(0, 10) ?? null]
    .filter((x): x is string => !!x)
    .sort()
    .pop();
  const semAcesso = ultimo ? diasEntre(ultimo, hoje) : null;
  if (semAcesso == null) {
    if (diasEntre(c.inicio, hoje) >= 7)
      add(40, {
        tipo: "churn",
        gravidade: "alta",
        titulo: "Nunca acessou",
        detalhe: `Conta criada há ${diasEntre(c.inicio, hoje)} dias sem nenhum acesso registrado.`,
      });
  } else if (semAcesso >= 14) {
    add(40, {
      tipo: "churn",
      gravidade: "alta",
      titulo: `Sem acesso há ${semAcesso} dias`,
      detalhe: `Último acesso em ${ultimo}.`,
    });
  } else if (semAcesso >= 7) {
    add(20, {
      tipo: "churn",
      gravidade: "media",
      titulo: `Sem acesso há ${semAcesso} dias`,
      detalhe: `Último acesso em ${ultimo}.`,
    });
  }

  // Queda contra o período anterior, com base mínima para não alertar ruído.
  const quedas: [Metrica, number, number, number][] = [
    // métrica, base mínima, pontos com queda >= 50%, pontos com queda >= 30%
    ["dias_ativos", 3, 25, 15],
    ["consultas", 5, 20, 10],
    ["agendamentos", 5, 10, 5],
  ];
  // Sem nenhum acesso no período, o alerta de "sem acesso" já diz tudo.
  const parado = semAcesso == null || semAcesso >= dias;
  for (const [m, base, forte, leve] of parado ? [] : quedas) {
    const x = comp[m];
    if (x.anterior < base || x.variacao == null || x.variacao > -0.3) continue;
    const grave = x.variacao <= -0.5;
    add(grave ? forte : leve, {
      tipo: "queda",
      gravidade: grave ? "alta" : "media",
      titulo: `Queda de ${pct(x.variacao)} em ${ROTULO[m]}`,
      detalhe: `${x.atual} nos últimos ${dias} dias contra ${x.anterior} no período anterior.`,
    });
  }

  // Abaixo da referência: parceiros (uso do app) e a própria média (consultas).
  // Conta criada dentro do período ainda não tem uso comparável.
  if (c.inicio > somarDias(hoje, -(dias - 1))) {
    pontos = Math.min(100, pontos);
    return { pontos, nivel: pontos >= 50 ? "alto" : pontos >= 25 ? "medio" : "baixo", alertas };
  }

  const dA = comp.dias_ativos;
  if (dA.media_parceiros != null && dA.atual < dA.media_parceiros * 0.5)
    add(10, {
      tipo: "queda",
      gravidade: "baixa",
      titulo: "Uso abaixo dos parceiros",
      detalhe: `${dA.atual} dias com acesso; a média dos parceiros é ${dA.media_parceiros}.`,
    });
  const cA = comp.consultas;
  if (cA.media_historica != null && cA.media_historica >= 5 && cA.atual < cA.media_historica * 0.6)
    add(10, {
      tipo: "queda",
      gravidade: "baixa",
      titulo: "Consultas abaixo da média histórica",
      detalhe: `${cA.atual} consultas; a média da clínica é ${cA.media_historica} por período.`,
    });

  const licencas = a.medicos + a.secretarias;
  if (licencas >= 2 && comp.usuarios_ativos.atual < licencas / 2)
    add(5, {
      tipo: "queda",
      gravidade: "baixa",
      titulo: "Usa poucas licenças",
      detalhe: `${comp.usuarios_ativos.atual} de ${licencas} licenças acessaram no período.`,
    });

  pontos = Math.min(100, pontos);
  return { pontos, nivel: pontos >= 50 ? "alto" : pontos >= 25 ? "medio" : "baixo", alertas };
}

const RECURSO: Record<string, string> = {
  copiloto: "Copiloto",
  whatsapp: "WhatsApp",
  video: "Vídeo",
};

/** Sinais de upgrade: consumo da franquia, adicionais comprados, licenças e uso acima da média. */
export function sinaisDeUpgrade(
  c: ClinicaUso,
  comp: Record<Metrica, Comparacao>,
  hoje: string,
): Alerta[] {
  if (!assinante(c)) return [];
  const a = c.assinatura!;
  const alertas: Alerta[] = [];
  const add = (x: Omit<Alerta, "clinica_id" | "clinica_nome" | "tipo">) =>
    alertas.push({ clinica_id: c.id, clinica_nome: c.nome, tipo: "upgrade", ...x });

  for (const r of c.consumo) {
    if (r.franquia <= 0) continue;
    const uso = r.usado / r.franquia;
    const nome = RECURSO[r.recurso] ?? r.recurso;
    if (uso >= 1)
      add({
        gravidade: "alta",
        titulo: `Ultrapassou a franquia de ${nome}`,
        detalhe: `${r.usado} de ${r.franquia} no mês (${pct(uso)}).`,
      });
    else if (uso >= 0.8)
      add({
        gravidade: "media",
        titulo: `Perto do limite de ${nome}`,
        detalhe: `${r.usado} de ${r.franquia} no mês (${pct(uso)}).`,
      });
  }

  const limite = somarDias(hoje, -90);
  const recentes = c.adicionais.filter((x) => x.data >= limite);
  if (recentes.length) {
    const porRecurso = new Map<string, number>();
    for (const x of recentes)
      porRecurso.set(x.recurso, (porRecurso.get(x.recurso) ?? 0) + x.quantidade);
    add({
      gravidade: recentes.length >= 2 ? "alta" : "media",
      titulo: "Comprou adicionais",
      detalhe: `${recentes.length} compra(s) em 90 dias: ${[...porRecurso]
        .map(([r, q]) => `${q} de ${RECURSO[r] ?? r}`)
        .join(", ")}.`,
    });
  }

  if (a.medicos > 0 && c.licencas_em_uso.medicos >= a.medicos)
    add({
      gravidade: "media",
      titulo: "Todas as licenças de médico em uso",
      detalhe: `${c.licencas_em_uso.medicos} de ${a.medicos} médicos ativos na agenda.`,
    });
  if (a.secretarias > 0 && c.licencas_em_uso.secretarias >= a.secretarias)
    add({
      gravidade: "baixa",
      titulo: "Todas as licenças de equipe em uso",
      detalhe: `${c.licencas_em_uso.secretarias} de ${a.secretarias} logins de equipe.`,
    });

  const cons = comp.consultas;
  if (
    a.plano !== "enterprise" &&
    cons.media_parceiros != null &&
    cons.media_parceiros > 0 &&
    cons.atual >= cons.media_parceiros * 1.5 &&
    cons.atual >= 20
  )
    add({
      gravidade: "baixa",
      titulo: "Uso bem acima dos parceiros",
      detalhe: `${cons.atual} consultas no período; a média dos parceiros é ${cons.media_parceiros}.`,
    });
  return alertas;
}

const PESO = { alta: 0, media: 1, baixa: 2 };
export function ordenarAlertas(xs: Alerta[]): Alerta[] {
  return [...xs].sort((a, b) => PESO[a.gravidade] - PESO[b.gravidade]);
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export type ResultadoClinica = {
  clinica_id: string;
  nome: string | null;
  plano: string | null;
  status: string | null;
  preco_mensal: number | null;
  ultimo_acesso: string | null;
  dias_sem_acesso: number | null;
  metricas: Record<Metrica, Comparacao>;
  risco: { pontos: number; nivel: "alto" | "medio" | "baixo" };
  consumo: (Consumo & { uso: number | null })[];
  licencas: {
    medicos: number;
    medicos_em_uso: number;
    secretarias: number;
    secretarias_em_uso: number;
  } | null;
  alertas: Alerta[];
};

function agrupar<T extends { clinica_id: string }>(xs: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const l = m.get(x.clinica_id) ?? [];
    l.push(x);
    m.set(x.clinica_id, l);
  }
  return m;
}

export function calcularUso(entrada: {
  hoje: string;
  dias: number;
  historicoDias: number;
  clinicas: ClinicaUso[];
  usuarios: DiaUsuario[];
  atividade: DiaAtividade[];
}) {
  const { hoje, dias, clinicas } = entrada;
  const p = periodos(hoje, dias, entrada.historicoDias);
  const usuariosPor = agrupar(entrada.usuarios);
  const atividadePor = agrupar(entrada.atividade);

  const valores = new Map<string, { atual: Valores; anterior: Valores; historico: Valores[] }>();
  for (const c of clinicas) {
    const u = usuariosPor.get(c.id) ?? [];
    const at = atividadePor.get(c.id) ?? [];
    valores.set(c.id, {
      atual: valoresNoPeriodo(u, at, p.atual),
      anterior: p.anterior ? valoresNoPeriodo(u, at, p.anterior) : valoresVazios(),
      // Só períodos inteiros depois que a conta existia.
      historico: p.anteriores
        .filter((x) => x.inicio >= c.inicio)
        .map((x) => valoresNoPeriodo(u, at, x)),
    });
  }

  // Parceiros de referência: assinantes que já existiam no começo do período.
  const referencia = clinicas.filter((c) => assinante(c) && c.inicio <= p.atual.inicio);

  const resultado: ResultadoClinica[] = clinicas.map((c) => {
    const v = valores.get(c.id)!;
    const metricas = Object.fromEntries(
      METRICAS.map((m) => [
        m,
        comparar(
          v.atual[m],
          v.anterior[m],
          v.historico.map((h) => h[m]),
          referencia.filter((o) => o.id !== c.id).map((o) => valores.get(o.id)!.atual[m]),
        ),
      ]),
    ) as Record<Metrica, Comparacao>;
    const dias_com_uso = (usuariosPor.get(c.id) ?? []).map((u) => u.dia).sort();
    const ultimoAcesso = dias_com_uso.pop() ?? null;
    const risco = riscoDeChurn(c, metricas, ultimoAcesso, hoje, dias);
    const upgrade = sinaisDeUpgrade(c, metricas, hoje);
    const ultimo =
      [ultimoAcesso, c.ultimo_login?.slice(0, 10) ?? null]
        .filter((x): x is string => !!x)
        .sort()
        .pop() ?? null;
    return {
      clinica_id: c.id,
      nome: c.nome,
      plano: c.assinatura?.plano ?? null,
      status: c.assinatura?.status ?? null,
      preco_mensal: c.assinatura?.preco_mensal ?? null,
      ultimo_acesso: ultimo,
      dias_sem_acesso: ultimo ? diasEntre(ultimo, hoje) : null,
      metricas,
      risco: { pontos: risco.pontos, nivel: risco.nivel },
      consumo: c.consumo.map((r) => ({
        ...r,
        uso: r.franquia > 0 ? arred(r.usado / r.franquia, 3) : null,
      })),
      licencas: c.assinatura
        ? {
            medicos: c.assinatura.medicos,
            medicos_em_uso: c.licencas_em_uso.medicos,
            secretarias: c.assinatura.secretarias,
            secretarias_em_uso: c.licencas_em_uso.secretarias,
          }
        : null,
      alertas: ordenarAlertas([...risco.alertas, ...upgrade]),
    };
  });

  const mediaParceiros = Object.fromEntries(
    METRICAS.map((m) => [m, arred(media(referencia.map((o) => valores.get(o.id)!.atual[m])))]),
  ) as Record<Metrica, number | null>;

  return {
    periodo: { ...p.atual, dias, anterior: p.anterior },
    parceiros: { quantidade: referencia.length, media: mediaParceiros },
    clinicas: resultado,
    alertas: ordenarAlertas(resultado.flatMap((r) => r.alertas)),
  };
}

/** Série diária somando todas as clínicas (ou uma), do início do período anterior até hoje. */
export function serieDiaria(
  usuarios: DiaUsuario[],
  atividade: DiaAtividade[],
  desde: string,
  hoje: string,
) {
  const dias = new Map<
    string,
    { dia: string; acessos: number; usuarios: number; consultas: number; agendamentos: number }
  >();
  for (let d = desde; d <= hoje; d = somarDias(d, 1))
    dias.set(d, { dia: d, acessos: 0, usuarios: 0, consultas: 0, agendamentos: 0 });
  for (const u of usuarios) {
    const x = dias.get(u.dia);
    if (!x) continue;
    x.acessos += u.acessos;
    x.usuarios += 1; // uma linha por login e dia
  }
  for (const a of atividade) {
    const x = dias.get(a.dia);
    if (!x) continue;
    x.consultas += a.consultas;
    x.agendamentos += a.agendamentos;
  }
  return [...dias.values()];
}

/** Telas mais usadas no período atual, com o anterior para comparar. */
export function rankingTelas(telas: DiaTela[], atual: Periodo, anterior: Periodo | null) {
  const m = new Map<
    string,
    { tela: string; eventos: number; anterior: number; clinicas: Set<string>; dias: Set<string> }
  >();
  for (const t of telas) {
    const noAtual = dentro(t.dia, atual);
    const noAnterior = anterior ? dentro(t.dia, anterior) : false;
    if (!noAtual && !noAnterior) continue;
    const x = m.get(t.tela) ?? {
      tela: t.tela,
      eventos: 0,
      anterior: 0,
      clinicas: new Set(),
      dias: new Set(),
    };
    if (noAtual) {
      x.eventos += t.eventos;
      x.clinicas.add(t.clinica_id);
      x.dias.add(t.dia);
    } else x.anterior += t.eventos;
    m.set(t.tela, x);
  }
  return [...m.values()]
    .map((x) => ({
      tela: x.tela,
      eventos: x.eventos,
      anterior: x.anterior,
      variacao: x.anterior > 0 ? arred((x.eventos - x.anterior) / x.anterior, 3) : null,
      clinicas: x.clinicas.size,
      dias: x.dias.size,
    }))
    .sort((a, b) => b.eventos - a.eventos);
}
