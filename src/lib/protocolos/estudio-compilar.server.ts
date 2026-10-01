// Compila o grafo do Studio (public/protocolo-studio.html) para o motor
// executável de protocolos: protocolo_acoes / protocolo_regras, gravados por
// public.salvar_protocolo (supabase/migrations/20261003120000_*).
//
// O grafo é mais expressivo que o motor. A tradução é:
//   Exame / Consulta / Medicamento  -> ação (Medicamento vira "Receita" com as
//                                      variações de dose em detalhes.esquemas)
//   aresta com lapso                -> start_day acumulado a partir da origem
//   Condição com 1 exame por ramo   -> regras no exame (ramo = regra; nós do
//                                      ramo = ações disparadas pelo resultado)
//   ramos ligados por OU entre exames -> uma regra por exame
//   cláusula de idade/sexo          -> criterio_paciente nas ações do ramo
//   Evento                          -> ação "Alerta" (ou Receita/Exame quando
//                                      o efeito é gerar receita/solicitar exame)
//   Admissão                        -> CIDs do protocolo + critério de idade/sexo
// O que o motor não avalia (E entre exames diferentes, estado de medicamento,
// gestação/peso, mais de uma condição no mesmo exame) vira um Alerta de
// "avaliar manualmente" no ponto do fluxo + pendência para o médico — nunca
// é descartado em silêncio.
//
// Cada ação/regra tem uma chave estável derivada do grafo (contexto + id do
// nó). A publicação anterior guarda chave -> uuid; reenviar o uuid faz o
// salvar_protocolo atualizar a mesma linha, preservando o histórico.

import { normCid } from "./gerar.server";

type Clausula = {
  sourceKind?: string;
  sourceNodeId?: string | null;
  conector?: string | null;
  campo?: string;
  operador?: string;
  numero?: string | number;
  numero_min?: string | number;
  numero_max?: string | number;
  texto?: string;
  conceito?: string;
  presente?: boolean;
  estado?: string;
  variavel?: string;
  valor?: string | number;
};

type Ramo = {
  id: string;
  isDefault?: boolean;
  descricao?: string;
  clauses?: Clausula[];
  repetir_gatilho_dias?: number | null;
};

export type NoGrafo = {
  id: string;
  type: string;
  name?: string;
  lapso?: number;
  tussId?: string | null;
  substanciaId?: string | null;
  especialidade?: string;
  dose?: string;
  posologia?: string;
  esquemas?: Record<string, string>[];
  linha_tratamento?: number | null;
  grupo_alternativa?: string;
  ceaf?: boolean;
  criterios_inclusao?: string[];
  criterios_exclusao?: string[];
  contraindicacoes?: string[];
  ajuste_renal_hepatico?: string;
  monitorizacao?: string;
  repetir_a_cada?: number;
  nome_documento?: string;
  clauses?: Clausula[];
  branches?: Ramo[];
  acao?: string;
  alvoId?: string | null;
  motivo?: string;
  conteudo?: string;
  destinatario?: string;
  fator?: string;
  nivel?: string;
};

export type ArestaGrafo = {
  id?: string;
  from: string;
  to: string;
  fromHandle?: string | null;
  lapso?: number;
};

export type GrafoEstudio = {
  nodes: NoGrafo[];
  edges: ArestaGrafo[];
  meta?: { cids?: string[]; fonte?: Record<string, unknown> };
};

export type Publicacao = { acoes?: Record<string, string>; regras?: Record<string, string> };

type Criterio = { idade_min?: number; idade_max?: number; sexo?: "F" | "M" };

type AcaoPayload = {
  id: string;
  tipo: "Exame" | "Consulta" | "Receita" | "Alerta";
  nome: string;
  start_day: number;
  frequency: number;
  recurrent: boolean;
  auto_restart: boolean;
  especialidade: string | null;
  descricao: string | null;
  tuss_procedimento_id: string | null;
  id_substancia: string | null;
  catalogo_status: "vinculado" | "pendente_cadastro" | "nao_aplicavel";
  detalhes: Record<string, unknown>;
  criterio_paciente: Criterio | null;
  regra_pai_id: string | null;
};

type RegraPayload = {
  id: string;
  acao_gatilho_id: string;
  descricao: string;
  condicao: Record<string, unknown> | null;
  ordem: number;
  is_default: boolean;
  repete_gatilho_apos_dias: number | null;
  compartilha_acoes_de: string | null;
};

export type ResultadoCompilacao = {
  payload: {
    id: string | null;
    titulo: string;
    cids: string[];
    fonte: Record<string, unknown>;
    acoes: AcaoPayload[];
    regras: RegraPayload[];
  };
  /** id enviado no payload -> chave estável do grafo */
  chaveDaAcao: Record<string, string>;
  chaveDaRegra: Record<string, string>;
  pendencias: string[];
  resumo: {
    acoes: number;
    regras: number;
    alertas: number;
    decisoes: number;
    avaliacaoManual: number;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNull = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

const n = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : undefined;
};
const dias = (v: unknown) => Math.max(0, Math.round(n(v) ?? 0));

type Contexto = {
  id: string;
  regraKey: string | null; // regra que dispara as ações deste contexto (null = fluxo principal)
  parent: Contexto | null;
  offset: number; // dias: desde o início do protocolo (raiz) ou desde o resultado (ramo)
  criterio: Criterio | null;
  trilha: Set<string>; // nós já percorridos neste caminho (evita ciclo infinito)
};

function chaveCriterio(c: Criterio | null) {
  return c ? `${c.idade_min ?? ""}-${c.idade_max ?? ""}-${c.sexo ?? ""}` : "";
}

/** Interseção de critérios; null = impossível (ex.: idade_min > idade_max). */
function juntarCriterio(a: Criterio | null, b: Criterio | null): Criterio | null | false {
  if (!a) return b;
  if (!b) return a;
  const out: Criterio = { ...a };
  if (b.idade_min !== undefined) out.idade_min = Math.max(out.idade_min ?? -Infinity, b.idade_min);
  if (b.idade_max !== undefined) out.idade_max = Math.min(out.idade_max ?? Infinity, b.idade_max);
  if (b.sexo) {
    if (out.sexo && out.sexo !== b.sexo) return false;
    out.sexo = b.sexo;
  }
  if (out.idade_min !== undefined && out.idade_max !== undefined && out.idade_min > out.idade_max)
    return false;
  return out;
}

/** Cláusula de paciente -> critério que o motor verifica (idade/sexo); null se não for convertível. */
function criterioDaClausula(c: Clausula): Criterio | null {
  if (c.sourceKind !== "paciente") return null;
  if (c.variavel === "sexo") {
    const s = String(c.valor ?? "")
      .toUpperCase()
      .charAt(0);
    return s === "F" || s === "M" ? { sexo: s } : null;
  }
  if (c.variavel !== "idade") return null;
  const v = n(c.valor);
  if (v === undefined) return null;
  switch (c.operador) {
    case "maior_que":
      return { idade_min: Math.floor(v) + 1 };
    case "maior_ou_igual":
      return { idade_min: Math.ceil(v) };
    case "menor_que":
      return { idade_max: Math.ceil(v) - 1 };
    case "menor_ou_igual":
      return { idade_max: Math.floor(v) };
    case "igual":
      return { idade_min: v, idade_max: v };
    default:
      return null;
  }
}

/** Complemento de um critério simples (para o "caso padrão"); null se não houver um único complemento. */
function negarCriterio(c: Criterio): Criterio | null {
  const keys = Object.keys(c);
  if (keys.length !== 1) return null;
  if (c.sexo) return { sexo: c.sexo === "F" ? "M" : "F" };
  if (c.idade_min !== undefined) return { idade_max: c.idade_min - 1 };
  if (c.idade_max !== undefined) return { idade_min: c.idade_max + 1 };
  return null;
}

/** Cláusula de exame -> condição de public.avaliar_condicao. */
function condicaoDaClausula(c: Clausula): Record<string, unknown> | null {
  if (c.campo === "achado")
    return c.conceito
      ? { campo: "achado", conceito: c.conceito, presente: c.presente !== false }
      : null;
  if (c.campo === "texto") {
    return c.texto && (c.operador === "igual" || c.operador === "contem")
      ? { campo: "texto", operador: c.operador, texto: String(c.texto) }
      : null;
  }
  if (c.operador === "entre" || c.operador === "fora_de") {
    const a = n(c.numero_min);
    const b = n(c.numero_max);
    return a === undefined || b === undefined
      ? null
      : {
          campo: "numero",
          operador: c.operador,
          numero_min: Math.min(a, b),
          numero_max: Math.max(a, b),
        };
  }
  const v = n(c.numero);
  const ops = ["maior_que", "menor_que", "maior_ou_igual", "menor_ou_igual", "igual"];
  return v === undefined || !ops.includes(String(c.operador))
    ? null
    : { campo: "numero", operador: c.operador, numero: v };
}

const ROTULO_PACIENTE: Record<string, string> = {
  sexo: "sexo",
  idade: "idade",
  peso: "peso",
  altura: "altura",
  gestante: "gestante",
  cid: "CID",
};

function resumoClausula(c: Clausula, nomes: Map<string, string>): string {
  if (c.sourceKind === "paciente")
    return `${ROTULO_PACIENTE[c.variavel || ""] || c.variavel} ${c.operador || "="} ${c.valor ?? "?"}`;
  const fonte = nomes.get(c.sourceNodeId || "") || "?";
  if (c.sourceKind === "medicamento")
    return `${fonte} ${c.estado === "suspenso" ? "suspenso" : "em uso"}`;
  if (c.campo === "achado")
    return `${fonte}: ${c.conceito} ${c.presente === false ? "ausente" : "presente"}`;
  if (c.operador === "entre" || c.operador === "fora_de")
    return `${fonte} ${c.operador.replace("_", " ")} ${c.numero_min}–${c.numero_max}`;
  return `${fonte} ${String(c.operador || "").replace(/_/g, " ")} ${c.campo === "texto" ? `"${c.texto}"` : c.numero}`;
}

export function compilarEstudio(
  grafo: GrafoEstudio,
  opts: { titulo: string; protocoloId?: string | null; publicacao?: Publicacao | null },
): ResultadoCompilacao {
  const nodes = (grafo.nodes || []).filter((x) => x && x.id && x.type);
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const edges = (grafo.edges || []).filter((e) => byId.has(e.from) && byId.has(e.to));
  const saidas = new Map<string, ArestaGrafo[]>();
  const temEntrada = new Set<string>();
  edges.forEach((e) => {
    (saidas.get(e.from) || saidas.set(e.from, []).get(e.from)!).push(e);
    temEntrada.add(e.to);
  });
  const nomes = new Map(nodes.map((x) => [x.id, x.name || x.type]));
  const pub = opts.publicacao || {};

  const pendencias: string[] = [];
  const pend = (m: string) => {
    if (!pendencias.includes(m)) pendencias.push(m);
  };
  const cids = new Set<string>(
    (grafo.meta?.cids || []).map(normCid).filter((c): c is string => !!c),
  );

  const acoes = new Map<string, AcaoPayload>(); // chave -> ação
  const regras = new Map<string, RegraPayload>(); // chave -> regra
  const instancia = new Map<string, string>(); // `${ctx.id}|${nodeId}` -> chave da ação
  const condicaoDoExame = new Map<string, string>(); // chave da ação-exame -> id da condição que a usa
  const condicoesFeitas = new Set<string>();
  const fila: { cond: NoGrafo; ctx: Contexto; lapso: number }[] = [];
  // condições que viram decisão manual: candidatos por condição (escolhe o
  // ponto mais profundo do fluxo onde ela é alcançada)
  const decisoes = new Map<string, { cond: NoGrafo; ctx: Contexto; start: number }[]>();
  const decididas = new Set<string>();
  let decisoesManuais = 0;
  let alternativasEscolha = 0;
  const visitados = new Set<string>();
  let avaliacaoManual = 0;

  const idPayload = (mapa: Record<string, string> | undefined, chave: string) =>
    uuidOuNull(mapa?.[chave]) || chave;

  function novoCtx(
    parent: Contexto | null,
    regraKey: string | null,
    offset: number,
    criterio: Criterio | null,
    trilha: Set<string>,
  ): Contexto {
    const id = `${regraKey ?? "raiz"}#${chaveCriterio(criterio)}`;
    return { id, regraKey, parent, offset, criterio, trilha };
  }

  /** Procura a ação já instanciada para um nó neste contexto ou nos ancestrais. */
  function acaoDoNo(nodeId: string, ctx: Contexto | null): string | null {
    for (let c = ctx; c; c = c.parent) {
      const hit = instancia.get(`${c.id}|${nodeId}`);
      if (hit) return hit;
    }
    // mesmo nó instanciado com outro critério no fluxo principal
    for (const [k, v] of instancia) if (k.endsWith(`|${nodeId}`) && k.startsWith("raiz#")) return v;
    return null;
  }

  function emitir(
    no: NoGrafo,
    ctx: Contexto,
    start: number,
    base: Partial<AcaoPayload> & Pick<AcaoPayload, "tipo" | "nome">,
  ): string {
    const chave = `${ctx.id}|${no.id}`;
    const existente = instancia.get(chave);
    if (existente) return existente;
    const acaoKey = `${ctx.regraKey ?? "raiz"}|${chaveCriterio(ctx.criterio)}|${no.id}`;
    const acao: AcaoPayload = {
      id: idPayload(pub.acoes, acaoKey),
      start_day: start,
      frequency: 0,
      recurrent: false,
      auto_restart: false,
      especialidade: null,
      descricao: null,
      tuss_procedimento_id: null,
      id_substancia: null,
      catalogo_status: "nao_aplicavel",
      detalhes: {},
      criterio_paciente: ctx.criterio,
      regra_pai_id: ctx.regraKey ? idPayload(pub.regras, ctx.regraKey) : null,
      ...base,
    };
    acoes.set(acaoKey, acao);
    instancia.set(chave, acaoKey);
    return acaoKey;
  }

  function alertaManual(ctx: Contexto, origem: NoGrafo, start: number, mensagem: string) {
    avaliacaoManual++;
    emitir({ ...origem, id: `${origem.id}::manual` }, ctx, start, {
      tipo: "Alerta",
      nome: `Avaliar: ${origem.name || "condição"}`,
      descricao: mensagem,
      detalhes: { nivel: "atencao", conduta: "reavaliar", mensagem, origem: "avaliacao_manual" },
    });
  }

  function dadosAcao(
    no: NoGrafo,
  ): (Partial<AcaoPayload> & Pick<AcaoPayload, "tipo" | "nome">) | null {
    const nome = (no.name || "").trim() || no.type;
    if (no.type === "Exame") {
      const tuss = uuidOuNull(no.tussId);
      if (!tuss)
        pend(
          `Exame "${nome}" sem vínculo com o catálogo TUSS — resultados não disparam as regras dele até vincular.`,
        );
      const rep = dias(no.repetir_a_cada);
      return {
        tipo: "Exame",
        nome,
        tuss_procedimento_id: tuss,
        catalogo_status: tuss ? "vinculado" : "pendente_cadastro",
        frequency: rep,
        recurrent: rep > 0,
        detalhes: no.nome_documento ? { nome_documento: no.nome_documento } : {},
      };
    }
    if (no.type === "Consulta") {
      const rep = dias(no.repetir_a_cada);
      return {
        tipo: "Consulta",
        nome,
        especialidade: no.especialidade || null,
        frequency: rep,
        recurrent: rep > 0,
      };
    }
    if (no.type === "Medicamento") {
      const sub = uuidOuNull(no.substanciaId);
      if (!sub) pend(`Medicamento "${nome}" sem vínculo com o catálogo de substâncias.`);
      const esquemas =
        no.esquemas && no.esquemas.length
          ? no.esquemas
          : no.dose || no.posologia
            ? [
                {
                  populacao: "",
                  dose: no.dose || "",
                  via: "",
                  posologia: no.posologia || "",
                  duracao: "",
                  dose_maxima: "",
                },
              ]
            : [];
      // grafos antigos não têm repetir_a_cada: medicamento assume renovação mensal
      const rep =
        no.repetir_a_cada === undefined || no.repetir_a_cada === null
          ? 30
          : dias(no.repetir_a_cada);
      return {
        tipo: "Receita",
        nome,
        id_substancia: sub,
        catalogo_status: sub ? "vinculado" : "pendente_cadastro",
        frequency: rep,
        recurrent: rep > 0,
        detalhes: {
          linha_tratamento: no.linha_tratamento ?? null,
          grupo_alternativa: no.grupo_alternativa || "",
          ceaf: !!no.ceaf,
          esquemas,
          criterios_inclusao: no.criterios_inclusao || [],
          criterios_exclusao: no.criterios_exclusao || [],
          contraindicacoes: no.contraindicacoes || [],
          ajuste_renal_hepatico: no.ajuste_renal_hepatico || "",
          monitorizacao: no.monitorizacao || "",
          ...(no.nome_documento ? { nome_documento: no.nome_documento } : {}),
        },
      };
    }
    if (no.type === "Evento") {
      const alvo = no.alvoId ? byId.get(no.alvoId) : undefined;
      const msg = (no.conteudo || no.motivo || no.name || "").trim();
      const nivel = ["info", "atencao", "critico"].includes(no.nivel || "")
        ? no.nivel
        : no.acao === "suspender"
          ? "critico"
          : "atencao";
      if (
        (no.acao === "gerar_receita" || no.acao === "enviar_receita") &&
        alvo?.type === "Medicamento"
      ) {
        const d = dadosAcao(alvo)!;
        return { ...d, nome: d.nome, descricao: msg || null };
      }
      if (no.acao === "solicitar_exame" && alvo?.type === "Exame") {
        const d = dadosAcao(alvo)!;
        return { ...d, frequency: 0, recurrent: false, descricao: msg || null };
      }
      if (no.acao === "mensagem_paciente") {
        pend(
          'Eventos "mensagem ao paciente" viram alerta para a equipe enviar — o envio ao paciente ainda não é automático.',
        );
      }
      const conduta =
        no.acao === "suspender"
          ? "suspender"
          : no.acao === "ajustar"
            ? "ajustar"
            : no.acao === "mensagem_paciente"
              ? "notificar"
              : "notificar";
      const mensagem =
        no.acao === "mensagem_paciente"
          ? `Enviar ao paciente: ${msg}`
          : no.acao === "ajustar" && no.fator
            ? `${msg}${msg ? " — " : ""}ajuste: ${no.fator}`
            : msg;
      return {
        tipo: "Alerta",
        frequency: dias(no.repetir_a_cada),
        recurrent: dias(no.repetir_a_cada) > 0,
        nome: (no.name || "").trim() || "Alerta",
        descricao: no.motivo || null,
        detalhes: {
          nivel,
          conduta,
          mensagem,
          medicamento_alvo: alvo?.name || "",
          destinatario: no.destinatario || "",
          acao_estudio: no.acao || "notificar_usuario",
        },
      };
    }
    return null;
  }

  /**
   * Visita os nós de destino de um conjunto de arestas que saem do mesmo ponto.
   * Medicamentos do mesmo "grupo de alternativas" (ex.: MTX, leflunomida,
   * sulfassalazina como MMCD sintético) não são todos prescritos: viram UMA
   * decisão "Escolher" e só o escolhido é agendado.
   */
  function visitarFilhos(lista: ArestaGrafo[], ctx: Contexto) {
    const grupos = new Map<string, ArestaGrafo[]>();
    const avulsas: ArestaGrafo[] = [];
    for (const e of lista) {
      const alvo = byId.get(e.to);
      const g = alvo?.type === "Medicamento" ? (alvo.grupo_alternativa || "").trim() : "";
      if (g) (grupos.get(g) || grupos.set(g, []).get(g)!).push(e);
      else avulsas.push(e);
    }
    grupos.forEach((es, g) => {
      if (es.length < 2) {
        avulsas.push(...es);
        return;
      }
      escolherAlternativa(g, es, ctx);
    });
    avulsas.forEach((e) => visitar(e.to, ctx, dias(e.lapso)));
  }

  function escolherAlternativa(grupo: string, es: ArestaGrafo[], ctx: Contexto) {
    const meds = es.map((e) => byId.get(e.to)!).filter((m) => !ctx.trilha.has(m.id));
    if (!meds.length) return;
    const lapsoMin = Math.min(...es.map((e) => dias(e.lapso)));
    const resumoDose = (m: NoGrafo) =>
      (m.esquemas || [])
        .map((x) =>
          [x.populacao, [x.dose, x.via, x.posologia].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(": "),
        )
        .join(" · ");
    const opcoes = meds.map((m) => ({
      valor: m.id,
      rotulo: m.name || "Medicamento",
      criterio: [m.linha_tratamento ? `${m.linha_tratamento}ª linha` : "", resumoDose(m)]
        .filter(Boolean)
        .join(" — "),
    }));
    const sintetico: NoGrafo = {
      id: `grupo:${grupo}:${meds.map((m) => m.id).join(",")}`,
      type: "Evento",
      name: grupo,
    };
    const acaoKey = emitir(sintetico, ctx, ctx.offset + lapsoMin, {
      tipo: "Alerta",
      nome: `Escolher: ${grupo}`,
      descricao: "Alternativas terapêuticas — escolha a que será prescrita; só ela é agendada.",
      detalhes: {
        nivel: "atencao",
        conduta: "decidir",
        mensagem: opcoes
          .map((o) => `• ${o.rotulo}${o.criterio ? ` (${o.criterio})` : ""}`)
          .join("\n"),
        opcoes,
      },
    });
    alternativasEscolha++;
    meds.forEach((m, i) => {
      const regraKey = `${acaoKey}>${m.id}`;
      regras.set(regraKey, {
        id: idPayload(pub.regras, regraKey),
        acao_gatilho_id: acoes.get(acaoKey)!.id,
        descricao: m.name || "Medicamento",
        condicao: { campo: "texto", operador: "igual", texto: m.id },
        ordem: i,
        is_default: false,
        repete_gatilho_apos_dias: null,
        compartilha_acoes_de: null,
      });
      const e = es.find((x) => x.to === m.id)!;
      visitar(m.id, novoCtx(ctx, regraKey, 0, null, ctx.trilha), dias(e.lapso) - lapsoMin);
    });
  }

  function visitar(nodeId: string, ctx: Contexto, lapso: number) {
    const no = byId.get(nodeId);
    if (!no) return;
    visitados.add(nodeId);
    if (ctx.trilha.has(nodeId)) {
      pend(
        `O fluxo volta para "${no.name}" (ciclo). Para repetir um exame num ramo, use "Repetir exame em N dias" no ramo da condição.`,
      );
      return;
    }
    const trilha = new Set(ctx.trilha).add(nodeId);

    if (no.type === "Condicao") {
      fila.push({ cond: no, ctx: { ...ctx, trilha }, lapso });
      return;
    }

    if (no.type === "Admissao") {
      let crit: Criterio | null = ctx.criterio;
      const manuais: string[] = [];
      (no.clauses || []).forEach((c, i) => {
        if (c.sourceKind === "paciente" && c.variavel === "cid") {
          String(c.valor ?? "")
            .split(/[,;\s]+/)
            .map(normCid)
            .forEach((x) => x && cids.add(x));
          return;
        }
        const cc = criterioDaClausula(c);
        if (cc && (i === 0 || c.conector !== "OU")) {
          const j = juntarCriterio(crit, cc);
          if (j !== false) crit = j;
          return;
        }
        manuais.push(resumoClausula(c, nomes));
      });
      const filho = novoCtx(ctx, ctx.regraKey, ctx.offset, crit, trilha);
      if (manuais.length) {
        alertaManual(filho, no, ctx.offset, `Confirmar elegibilidade: ${manuais.join("; ")}.`);
        pend(
          `Critérios de admissão que o sistema não verifica sozinho (${manuais.join("; ")}) viraram alerta de confirmação no início do protocolo.`,
        );
      }
      const saidasAdm = saidas.get(no.id) || [];
      if (saidasAdm.some((e) => e.fromHandle === "nao_admitido")) {
        pend(
          `O ramo "Não admitido" de "${no.name}" não é publicado: pacientes só entram no protocolo pelo CID.`,
        );
      }
      visitarFilhos(
        saidasAdm.filter((e) => e.fromHandle !== "nao_admitido"),
        filho,
      );
      return;
    }

    const dados = dadosAcao(no);
    if (!dados) return;
    const start = ctx.offset + lapso;
    emitir(no, ctx, start, dados);
    const depois: Contexto = { ...ctx, offset: start, trilha };
    visitarFilhos(saidas.get(no.id) || [], depois);
  }

  type Plano =
    | { tipo: "paciente"; ramo: Ramo; criterio: Criterio | null }
    | {
        tipo: "exame";
        ramo: Ramo;
        gatilhos: { exameNo: string; condicao: Record<string, unknown> }[];
        criterio: Criterio | null;
      }
    | { tipo: "manual"; ramo: Ramo; motivo: string };

  const textoRamo = (ramo: Ramo) => {
    const cl = ramo.clauses || [];
    const ou = cl.slice(1).some((c) => c.conector === "OU");
    return cl.map((c) => resumoClausula(c, nomes)).join(ou ? " OU " : " E ");
  };

  function planejar(ramo: Ramo, ctx: Contexto, condId: string): Plano {
    const cl = ramo.clauses || [];
    if (!cl.length) return { tipo: "manual", ramo, motivo: "ramo sem critério" };
    const exames = cl.filter((c) => c.sourceKind === "exame");
    const pacientes = cl.filter((c) => c.sourceKind === "paciente");
    const temOU = cl.slice(1).some((c) => c.conector === "OU");
    if (cl.some((c) => c.sourceKind !== "exame" && c.sourceKind !== "paciente"))
      return { tipo: "manual", ramo, motivo: "depende do estado de um medicamento" };

    let criterio: Criterio | null = null;
    for (const pc of pacientes) {
      const cc = criterioDaClausula(pc);
      if (!cc)
        return {
          tipo: "manual",
          ramo,
          motivo: `usa ${ROTULO_PACIENTE[pc.variavel || ""] || pc.variavel}, que o sistema não verifica`,
        };
      const j = juntarCriterio(criterio, cc);
      if (j === false)
        return { tipo: "manual", ramo, motivo: "critérios de paciente contraditórios" };
      criterio = j;
    }
    if (!exames.length) {
      if (temOU) return { tipo: "manual", ramo, motivo: "OU entre dados do paciente" };
      return { tipo: "paciente", ramo, criterio };
    }
    if (temOU && pacientes.length)
      return { tipo: "manual", ramo, motivo: "mistura OU entre exame e dado do paciente" };
    if (!temOU && exames.length > 1)
      return { tipo: "manual", ramo, motivo: "combina mais de um limite de exame com E" };

    const gatilhos: { exameNo: string; condicao: Record<string, unknown> }[] = [];
    for (const c of exames) {
      const cnd = condicaoDaClausula(c);
      if (!cnd || !c.sourceNodeId)
        return { tipo: "manual", ramo, motivo: "limite do exame incompleto" };
      const acaoKey = acaoDoNo(c.sourceNodeId, ctx);
      if (!acaoKey)
        return {
          tipo: "manual",
          ramo,
          motivo: `o exame "${nomes.get(c.sourceNodeId)}" não está neste caminho do fluxo`,
        };
      // O motor usa a primeira regra que bate entre TODAS as do exame; duas
      // condições no mesmo exame misturariam decisões diferentes.
      const dono = condicaoDoExame.get(acaoKey);
      if (dono && dono !== condId)
        return {
          tipo: "manual",
          ramo,
          motivo: `o exame "${nomes.get(c.sourceNodeId)}" já decide a condição "${nomes.get(dono)}"`,
        };
      gatilhos.push({ exameNo: c.sourceNodeId, condicao: cnd });
    }
    return { tipo: "exame", ramo, gatilhos, criterio };
  }

  function compilarCondicao(cond: NoGrafo, ctx: Contexto, lapso: number) {
    const chaveCond = `${ctx.id}|${cond.id}`;
    if (condicoesFeitas.has(chaveCond)) return;
    condicoesFeitas.add(chaveCond);

    const ramos = cond.branches || [];
    const normais = ramos.filter((r) => !r.isDefault);
    const padrao = ramos.find((r) => r.isDefault);
    const ramoFilhos = (ramo: Ramo) =>
      (saidas.get(cond.id) || []).filter((e) => e.fromHandle === ramo.id);
    const filhosPadrao = padrao ? ramoFilhos(padrao) : [];

    const planos = normais.map((r) => planejar(r, ctx, cond.id));
    const examesDistintos = new Set(
      planos.flatMap((p) => (p.tipo === "exame" ? p.gatilhos.map((g) => g.exameNo) : [])),
    );
    const todosExame = planos.length > 0 && planos.every((p) => p.tipo === "exame");
    const todosPaciente = planos.length > 0 && planos.every((p) => p.tipo === "paciente");
    const critsPac = todosPaciente
      ? (planos
          .map((p) => (p as { criterio: Criterio | null }).criterio)
          .filter(Boolean) as Criterio[])
      : [];
    const negPadrao = critsPac.length === 1 ? negarCriterio(critsPac[0]) : null;

    // Vira decisão do médico quando o motor não consegue avaliar algum ramo
    // sozinho, ou quando o "caso padrão" não tem como ser expresso.
    const decisao =
      planos.some((p) => p.tipo === "manual") ||
      (!todosExame && !todosPaciente) ||
      (todosPaciente && filhosPadrao.length > 0 && !negPadrao);
    if (decisao) {
      const start = ctx.offset + lapso;
      (decisoes.get(cond.id) || decisoes.set(cond.id, []).get(cond.id)!).push({ cond, ctx, start });
      return;
    }

    if (todosPaciente) {
      for (const p of planos as Extract<Plano, { tipo: "paciente" }>[]) {
        const crit = juntarCriterio(ctx.criterio, p.criterio);
        if (crit === false) continue;
        const filho = novoCtx(ctx, ctx.regraKey, ctx.offset, crit, ctx.trilha);
        visitarFilhos(ramoFilhos(p.ramo), filho);
      }
      const crit = juntarCriterio(ctx.criterio, negPadrao);
      if (crit !== false && filhosPadrao.length) {
        const filho = novoCtx(ctx, ctx.regraKey, ctx.offset, crit, ctx.trilha);
        visitarFilhos(filhosPadrao, filho);
      }
      return;
    }

    // Todos os ramos dependem de exame.
    let ordem = 0;
    for (const p of planos as Extract<Plano, { tipo: "exame" }>[]) {
      let dona: string | null = null; // regra que "possui" as ações do ramo
      p.gatilhos.forEach((g, gi) => {
        const acaoKey = acaoDoNo(g.exameNo, ctx)!;
        condicaoDoExame.set(acaoKey, cond.id);
        const regraKey = `${acaoKey}>${cond.id}>${p.ramo.id}${p.gatilhos.length > 1 ? `>${gi}` : ""}`;
        const repete = dias(p.ramo.repetir_gatilho_dias) || null;
        regras.set(regraKey, {
          id: idPayload(pub.regras, regraKey),
          acao_gatilho_id: acoes.get(acaoKey)!.id,
          descricao: p.ramo.descricao || textoRamo(p.ramo),
          condicao: g.condicao,
          ordem: ordem++,
          is_default: false,
          repete_gatilho_apos_dias: repete,
          compartilha_acoes_de: dona ? regras.get(dona)!.id : null,
        });
        if (repete) acoes.get(acaoKey)!.recurrent = false; // repetição passa a ser controlada pelas regras
        if (dona) return; // "OU" entre exames: as ações do ramo existem uma vez só
        dona = regraKey;
        const crit = juntarCriterio(null, p.criterio);
        const filho = novoCtx(ctx, regraKey, 0, crit === false ? null : crit, ctx.trilha);
        visitarFilhos(ramoFilhos(p.ramo), filho);
      });
    }

    if (!padrao) return;
    if (examesDistintos.size === 1) {
      const acaoKey = acaoDoNo([...examesDistintos][0], ctx)!;
      const regraKey = `${acaoKey}>${cond.id}>${padrao.id}`;
      const repete = dias(padrao.repetir_gatilho_dias) || null;
      regras.set(regraKey, {
        id: idPayload(pub.regras, regraKey),
        acao_gatilho_id: acoes.get(acaoKey)!.id,
        descricao: padrao.descricao || "Caso padrão",
        condicao: null,
        ordem: ordem++,
        is_default: true,
        repete_gatilho_apos_dias: repete,
        compartilha_acoes_de: null,
      });
      if (repete) acoes.get(acaoKey)!.recurrent = false;
      const filho = novoCtx(ctx, regraKey, 0, null, ctx.trilha);
      visitarFilhos(filhosPadrao, filho);
    } else if (filhosPadrao.length) {
      // Com exames diferentes, cada resultado é avaliado sozinho: um exame
      // normal dispararia o "caso padrão" mesmo com outro exame alterado.
      pend(
        `Caso padrão da condição "${cond.name}" não foi publicado: os ramos usam exames diferentes, e um exame normal dispararia o caso padrão mesmo com outro alterado. Itens não publicados: ${filhosPadrao.map((e) => nomes.get(e.to)).join(", ")}.`,
      );
    }
  }

  /** Condição que o motor não avalia sozinho: vira uma tarefa de decisão para o médico. */
  function compilarDecisao(cond: NoGrafo, ctx: Contexto, start: number) {
    decisoesManuais++;
    // ramo sem cláusula mas descrito (subtipo, estádio, falha da linha
    // anterior…) é uma opção legítima da decisão, não um ramo vazio
    const ramos = (cond.branches || []).filter(
      (r) => r.isDefault || (r.clauses || []).length || (r.descricao || "").trim(),
    );
    const opcoes = ramos.map((r) => ({
      valor: r.id,
      rotulo: r.isDefault
        ? r.descricao || "Nenhum dos critérios acima"
        : r.descricao || textoRamo(r),
      criterio: r.isDefault ? "" : textoRamo(r),
    }));
    const acaoKey = emitir({ ...cond, id: `${cond.id}::decisao` }, ctx, start, {
      tipo: "Alerta",
      nome: `Decidir: ${cond.name || "condição"}`,
      descricao: "Escolha o caminho que se aplica ao paciente; as ações dele são geradas a seguir.",
      detalhes: {
        nivel: "atencao",
        conduta: "decidir",
        mensagem: opcoes
          .map((o) => `• ${o.rotulo}${o.criterio ? ` (${o.criterio})` : ""}`)
          .join("\n"),
        opcoes,
      },
    });
    ramos.forEach((r, i) => {
      // a escolha do médico chega ao motor como resultado em texto = id do ramo
      const regraKey = `${acaoKey}>${r.id}`;
      regras.set(regraKey, {
        id: idPayload(pub.regras, regraKey),
        acao_gatilho_id: acoes.get(acaoKey)!.id,
        descricao: opcoes[i].rotulo,
        condicao: { campo: "texto", operador: "igual", texto: r.id },
        ordem: i,
        is_default: false,
        repete_gatilho_apos_dias: null,
        compartilha_acoes_de: null,
      });
      const filho = novoCtx(ctx, regraKey, 0, null, ctx.trilha);
      visitarFilhos(
        (saidas.get(cond.id) || []).filter((e) => e.fromHandle === r.id),
        filho,
      );
    });
  }

  const profundidade = (c: Contexto) => {
    let d = 0;
    for (let x: Contexto | null = c; x; x = x.parent) if (x.regraKey) d++;
    return d;
  };

  // ---- percurso ---------------------------------------------------------------
  const raiz = novoCtx(null, null, 0, null, new Set());
  const raizes = nodes.filter((x) => !temEntrada.has(x.id));
  // Admissão primeiro, para o critério dela valer no resto do fluxo
  raizes.sort((a, b) => (a.type === "Admissao" ? -1 : 0) - (b.type === "Admissao" ? -1 : 0));
  visitarFilhos(
    raizes.map((r) => ({ from: "", to: r.id, lapso: r.lapso })),
    raiz,
  );
  for (;;) {
    // Condições são compiladas depois que as ações do mesmo trecho existem
    // (as regras precisam do exame-gatilho já instanciado).
    while (fila.length) {
      const { cond, ctx, lapso } = fila.shift()!;
      compilarCondicao(cond, ctx, lapso);
    }
    const pendente = [...decisoes.keys()].find((k) => !decididas.has(k));
    if (!pendente) break;
    decididas.add(pendente);
    // Uma condição alcançada por vários caminhos vira UMA decisão, no ponto
    // mais adiantado do fluxo (ex.: "trocar para análogo" depois do início
    // do tratamento, não no dia do diagnóstico).
    const melhor = decisoes
      .get(pendente)!
      .sort((a, b) => profundidade(b.ctx) - profundidade(a.ctx) || b.start - a.start)[0];
    compilarDecisao(melhor.cond, melhor.ctx, melhor.start);
  }
  if (alternativasEscolha) {
    pend(
      `${alternativasEscolha} grupo(s) de medicamentos alternativos viram uma escolha "Escolher: <grupo>" para o médico — só o medicamento escolhido é agendado.`,
    );
  }
  if (decisoesManuais) {
    pend(
      `${decisoesManuais} condição(ões) usam critérios que o sistema não avalia sozinho (gestação, estado de medicamento, combinação de exames…). Elas viram tarefas "Decidir" na aba de protocolos do paciente: o médico escolhe o caminho e as ações dele são geradas.`,
    );
  }

  const soltos = nodes.filter((x) => !visitados.has(x.id) && x.type !== "Condicao");
  if (soltos.length)
    pend(
      `Nós fora de qualquer caminho publicável (só alcançáveis por ramos não automatizáveis ou ciclos): ${soltos.map((x) => x.name).join(", ")}.`,
    );
  if (!cids.size)
    pend(
      "Sem CID: informe os CIDs do protocolo (painel do protocolo ou critério de CID na Admissão) — sem eles nenhum paciente é vinculado.",
    );

  const listaAcoes = [...acoes.values()];
  const chaveDaAcao: Record<string, string> = {};
  acoes.forEach((a, k) => (chaveDaAcao[a.id] = k));
  const chaveDaRegra: Record<string, string> = {};
  regras.forEach((r, k) => (chaveDaRegra[r.id] = k));

  return {
    payload: {
      id: uuidOuNull(opts.protocoloId),
      titulo: opts.titulo,
      cids: [...cids],
      fonte: grafo.meta?.fonte || {},
      acoes: listaAcoes,
      regras: [...regras.values()],
    },
    chaveDaAcao,
    chaveDaRegra,
    pendencias,
    resumo: {
      acoes: listaAcoes.length,
      regras: regras.size,
      alertas: listaAcoes.filter((a) => a.tipo === "Alerta").length,
      decisoes: decisoesManuais + alternativasEscolha,
      avaliacaoManual,
    },
  };
}
