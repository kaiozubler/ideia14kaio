// IA do Studio de protocolos (public/protocolo-studio.html): transforma um PDF
// (PCDT, diretriz, artigo) e/ou texto do médico no GRAFO do Studio — nós
// Admissão/Exame/Medicamento/Consulta/Condição/Evento ligados por arestas com
// lapso em dias.
//
// Antes o prompt ficava no navegador e a resposta da IA ia direto para o
// canvas: nós sem vínculo com o catálogo, referências quebradas (cláusula
// apontando para nó inexistente, aresta para ramo que não existe) e limite de
// ~40 nós. Aqui o prompt é do servidor, voltado a PCDT, e tudo que volta passa
// por normalização/validação e pelo cruzamento com TUSS/substâncias. O que não
// dá para corrigir sozinho vira pendência de revisão.

import {
  ErroGeracaoProtocolo,
  GATEWAY_URL,
  MAX_TOKENS,
  MODEL,
  emLotes,
  normCid,
  normKey,
  num,
  parseJsonStrict,
  similaridade,
  str,
  strList,
} from "./gerar.server";

export type TipoNo = "Admissao" | "Exame" | "Medicamento" | "Consulta" | "Condicao" | "Evento";

export type Clausula = {
  sourceKind: "exame" | "medicamento" | "paciente";
  sourceLocalId?: string | null;
  conector: "E" | "OU" | null;
  campo?: "numero" | "texto" | "achado";
  operador?: string;
  numero?: string;
  numero_min?: string;
  numero_max?: string;
  texto?: string;
  conceito?: string;
  presente?: boolean;
  estado?: "em_uso" | "suspenso";
  variavel?: string;
  valor?: string;
};

export type Esquema = {
  populacao: string;
  dose: string;
  via: string;
  posologia: string;
  duracao: string;
  dose_maxima: string;
};

export type NoEstudio = {
  localId: string;
  type: TipoNo;
  name: string;
  // Exame
  tussId?: string | null;
  codigoTuss?: string | null;
  // Medicamento
  substanciaId?: string | null;
  linha_tratamento?: number | null;
  grupo_alternativa?: string;
  ceaf?: boolean;
  esquemas?: Esquema[];
  criterios_inclusao?: string[];
  criterios_exclusao?: string[];
  contraindicacoes?: string[];
  ajuste_renal_hepatico?: string;
  monitorizacao?: string;
  // Exame / Medicamento / Consulta
  repetir_a_cada?: number;
  nome_documento?: string;
  // Consulta
  especialidade?: string;
  // Admissao
  clauses?: Clausula[];
  // Condicao
  branches?: {
    localId: string;
    isDefault: boolean;
    descricao: string;
    clauses: Clausula[];
    repetir_gatilho_dias?: number | null;
  }[];
  // Evento
  acao?: string;
  alvoLocalId?: string | null;
  motivo?: string;
  conteudo?: string;
  destinatario?: string;
  fator?: string;
  nivel?: "info" | "atencao" | "critico";
};

export type ArestaEstudio = {
  fromLocalId: string;
  fromHandle: string | null;
  toLocalId: string;
  lapso: number;
};

export type FluxoGerado = {
  name: string;
  cids: string[];
  fonte: { tipo_documento: string; orgao: string; portaria: string; ano: string; arquivo: string };
  nodes: NoEstudio[];
  edges: ArestaEstudio[];
  pendencias: string[];
};

const SYSTEM = `Você transforma PCDTs (Protocolos Clínicos e Diretrizes Terapêuticas do Ministério da Saúde),
diretrizes de sociedades médicas e artigos em um GRAFO de protocolo assistencial para um editor visual.
O grafo depois é publicado num motor que agenda tarefas, avalia resultados de exames e dispara alertas,
então ele precisa ser COMPLETO e EXECUTÁVEL.

COMO LER UM PCDT
Percorra TODAS as seções — CID-10 contemplados, critérios de inclusão/exclusão, casos especiais
(gestantes, crianças, idosos, insuficiência renal/hepática), tratamento (fármacos, esquemas, tempo de
tratamento, critérios de interrupção), monitorização (exames, periodicidade, valores que exigem
ajuste/suspensão), acompanhamento — inclusive tabelas, quadros, fluxogramas e anexos.

Responda APENAS com um objeto JSON válido:
{
  "name": "Nome curto do protocolo",
  "cids": ["E10.0", "E10.1"],
  "fonte": { "tipo_documento": "PCDT"|"Diretriz"|"Artigo"|"Instrução", "orgao": "", "portaria": "", "ano": "" },
  "nodes": [
    { "localId": "n1", "type": "Admissao", "name": "...", "clauses": [ {"sourceKind":"paciente","variavel":"cid","operador":"contem","valor":"E10","conector":null} ] },
    { "localId": "n2", "type": "Exame", "name": "Hemoglobina glicada", "sinonimos": ["HbA1c"], "repetir_a_cada": 90 },
    { "localId": "n3", "type": "Medicamento", "name": "Metformina", "sinonimos": [],
      "linha_tratamento": 1, "grupo_alternativa": "Biguanida", "ceaf": false,
      "esquemas": [ { "populacao": "Adulto", "dose": "500 mg", "via": "oral", "posologia": "2x/dia", "duracao": "contínuo", "dose_maxima": "2.550 mg/dia" } ],
      "criterios_inclusao": [], "criterios_exclusao": [], "contraindicacoes": ["TFG < 30"],
      "ajuste_renal_hepatico": "", "monitorizacao": "", "repetir_a_cada": 30 },
    { "localId": "n4", "type": "Consulta", "name": "...", "especialidade": "...", "repetir_a_cada": 180 },
    { "localId": "n5", "type": "Condicao", "name": "...", "branches": [
        { "localId": "b1", "isDefault": false, "descricao": "...", "repetir_gatilho_dias": 30, "clauses": [
            {"sourceKind":"exame","sourceLocalId":"n2","campo":"numero","operador":"maior_ou_igual","numero":"7","conector":null},
            {"sourceKind":"paciente","variavel":"idade","operador":"maior_ou_igual","valor":"18","conector":"E"}
        ] },
        { "localId": "b2", "isDefault": true, "descricao": "Meta atingida" }
    ] },
    { "localId": "n6", "type": "Evento", "name": "...", "acao": "suspender", "alvoLocalId": "n3", "nivel": "critico", "repetir_a_cada": 0,
      "motivo": "...", "conteudo": "...", "destinatario": "Médico responsável" }
  ],
  "edges": [
    { "fromLocalId": "n1", "fromHandle": "admitido", "toLocalId": "n2", "lapso": 0 },
    { "fromLocalId": "n2", "fromHandle": null, "toLocalId": "n5", "lapso": 0 },
    { "fromLocalId": "n5", "fromHandle": "b1", "toLocalId": "n6", "lapso": 0 }
  ],
  "observacoes_revisao": ["..."]
}

TIPOS DE NÓ
- Admissao: portão de entrada (critérios do paciente). Saídas "admitido" / "nao_admitido". Use no máximo uma.
- Exame: exame/procedimento. "repetir_a_cada" = periodicidade de monitorização em dias (0 = única vez).
- Medicamento: UM princípio ativo por nó. "repetir_a_cada" = renovação da receita em dias (30 se uso
  contínuo e o documento não disser; 0 se dose única/curso fechado).
- Consulta: consulta/avaliação. "repetir_a_cada" = periodicidade em dias.
- Condicao: decisão. Cada ramo tem cadeia de cláusulas (E/OU) ou isDefault = true. Exatamente UM ramo
  isDefault por condição, sempre o último. O handle da aresta de saída é o localId do ramo.
- Evento: automação/alerta. "acao": suspender | ajustar | mensagem_paciente | notificar_usuario |
  gerar_receita | enviar_receita | solicitar_exame. "alvoLocalId" aponta o nó afetado. "nivel":
  info | atencao | critico. "repetir_a_cada" (dias) para alertas periódicos (ex.: renovar LME a cada 90).

TRATAMENTO MEDICAMENTOSO — TODAS AS VARIAÇÕES
- Um nó Medicamento por fármaco citado no tratamento, incluindo TODAS as alternativas de cada linha.
- Variações de dose do MESMO fármaco (adulto x pediátrico, por kg/m², ataque x manutenção, titulação,
  ajuste renal) vão em "esquemas", um item por variação, com "populacao" dizendo a quem se aplica.
- "linha_tratamento": 1 para primeira linha, 2 para segunda... Fármacos intercambiáveis (o médico escolhe
  um) compartilham "grupo_alternativa".
- Troca de linha condicionada a exame (ex.: "HbA1c ≥ 7% após 3 meses") = Exame → Condicao → ramo →
  Medicamento da linha seguinte. Troca por critério clínico não mensurável (intolerância, falha avaliada
  em consulta) = Evento "notificar_usuario" de reavaliação no prazo do documento, apontando o fármaco.
- Fármaco restrito a uma população = Condicao com cláusula de paciente (idade/sexo) antes dele.
- Fármacos usados JUNTOS no mesmo esquema (ex.: trastuzumabe + pertuzumabe + taxano) NÃO compartilham
  "grupo_alternativa" — grupo é só para quando o médico escolhe UM entre eles.
- "ceaf": true quando dispensado pelo Componente Especializado (exige LME).

MONITORIZAÇÃO, RAMIFICAÇÕES E ALERTAS
- Cada exame de monitorização é um nó Exame com "repetir_a_cada". Quando o documento disser o que fazer
  conforme o resultado: Exame → Condicao (aresta com fromHandle null) e um ramo por faixa.
- Cláusulas de exame SEMPRE apontam (sourceLocalId) para um Exame que tem aresta chegando na Condicao.
- Repetir o exame em N dias dentro de um ramo = "repetir_gatilho_dias" no ramo (não crie outro nó igual).
- Operadores numéricos: maior_que, menor_que, maior_ou_igual, menor_ou_igual, entre, fora_de, igual.
  Use exatamente o limite do texto ("≥ 7%" → maior_ou_igual "7"). "> 3x LSN" sem valor absoluto →
  campo "achado", conceito em MAIÚSCULAS (ex.: "TGO_ACIMA_3X_LSN"). Qualitativo ("reagente") → campo
  "texto" com operador "contem".
- Toxicidade/resultado crítico → Evento "suspender" ou "ajustar" (nivel "critico") no ramo do exame.
- Biomarcadores e subtipos (receptor hormonal, HER2, Ki-67, mutações) são RESULTADOS de exame: cláusula
  "sourceKind":"exame" apontando para o exame que os mede (ex.: imuno-histoquímica), "campo":"texto",
  "operador":"contem", "texto":"HER2 positivo". Nunca invente variáveis de paciente para eles.
- Critério que nenhum exame/variável expressa (estadiamento clínico, menopausa, doença residual,
  falha/intolerância, avaliação clínica): ramo com "descricao" objetiva e "clauses": [] — vira uma
  decisão do médico ("Decidir") na publicação. Nunca omita o ramo.
- Prazos (reavaliar resposta em 12 semanas, renovar LME a cada 3 meses, tempo máximo de tratamento,
  critérios de interrupção, notificação compulsória, encaminhamento) → Evento "notificar_usuario" com
  "conteudo" objetivo, ligado ao nó de onde o prazo conta, com "lapso" em dias na aresta.
- "lapso" da aresta = dias entre o nó de origem e o de destino.

CONECTIVIDADE (OBRIGATÓRIO)
- O fluxo começa SEMPRE na Admissao (com os CIDs). Todo outro nó é alcançável a partir dela por arestas;
  nenhum nó fica solto.
- Evento "suspender"/"ajustar" sai SEMPRE de um ramo de Condicao (o critério que o dispara), nunca
  direto de um Exame/Medicamento nem solto.
- Medicamentos de 2ª linha em diante saem de um ramo de Condicao (falha/progressão/intolerância da linha
  anterior) ligado à linha anterior. Tratamento por subtipo/estádio sai do ramo correspondente.

PACIENTE
- Variáveis de paciente: sexo (M/F), idade (anos), peso (kg), altura (cm), gestante (Sim/Não), cid.

NOMES (CRÍTICO PARA O VÍNCULO COM O CATÁLOGO)
- Exame: nome clínico oficial, curto e pesquisável ("Creatinina sérica", "TGO (AST)"); um exame por nó.
  Até 3 "sinonimos", incluindo o nome como aparece na tabela TUSS (ex.: "Mamografia convencional
  bilateral", "Imunoistoquímica").
- Medicamento: princípio ativo em português (DCB), sem dose, sal opcional e sem nome comercial
  ("Trastuzumabe entansina", não "T-DM1"). "sinonimos" só com outros nomes do MESMO princípio ativo
  (nunca a classe, ex.: "inibidor de CDK4/6").
- CIDs: todos os códigos contemplados, formato "E10.0" ou "E10".

LIMITES
- Até 80 nós. Se o documento for maior, priorize: tratamento completo (todas as linhas e variações),
  monitorização com condutas, alertas de segurança; depois o restante. Nomes curtos.
- Nunca invente fármacos, doses, exames ou limites. Ambiguidades vão em "observacoes_revisao".
- Instruções do médico têm prioridade sobre o documento.
- Nenhum texto fora do JSON.`;

const TIPOS: TipoNo[] = ["Admissao", "Exame", "Medicamento", "Consulta", "Condicao", "Evento"];
const ACOES_EVENTO = [
  "suspender",
  "ajustar",
  "mensagem_paciente",
  "notificar_usuario",
  "gerar_receita",
  "enviar_receita",
  "solicitar_exame",
];
const ALVO_EVENTO: Record<string, TipoNo[]> = {
  suspender: ["Medicamento", "Exame", "Consulta"],
  ajustar: ["Medicamento"],
  gerar_receita: ["Medicamento"],
  enviar_receita: ["Medicamento"],
  solicitar_exame: ["Exame"],
};
const OPS_NUMERO = [
  "maior_que",
  "menor_que",
  "maior_ou_igual",
  "menor_ou_igual",
  "entre",
  "fora_de",
  "igual",
];
const OPS_TEXTO = ["igual", "contem"];
const VARS_PACIENTE = ["sexo", "idade", "peso", "altura", "gestante", "cid"];

function normTipo(v: unknown): TipoNo | null {
  const t = normKey(str(v));
  if (/receita|farmac|medicament/.test(t)) return "Medicamento";
  if (/condic|decis/.test(t)) return "Condicao";
  if (/admiss|inclus/.test(t)) return "Admissao";
  if (/alerta|evento|automac|notific/.test(t)) return "Evento";
  return TIPOS.find((x) => x.toLowerCase() === t) || null;
}

function diasNaoNeg(v: unknown): number {
  const n = num(v);
  return n === undefined ? 0 : Math.max(0, Math.round(n));
}

function numStr(v: unknown): string | undefined {
  const n = num(v);
  return n === undefined ? undefined : String(n);
}

function conceitoMaiusculo(v: unknown): string {
  return str(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Normaliza uma cláusula; null quando não dá para avaliar. */
function normClausula(c: any, tipoDe: (id: string) => TipoNo | undefined): Clausula | null {
  if (!c || typeof c !== "object") return null;
  const conector = str(c.conector).toUpperCase() === "OU" ? "OU" : "E";
  const kind = str(c.sourceKind);
  if (kind === "paciente") {
    const variavel = str(c.variavel).toLowerCase();
    if (!VARS_PACIENTE.includes(variavel)) return null;
    const valor = str(c.valor);
    if (!valor) return null;
    let operador = str(c.operador) || "igual";
    if (variavel === "sexo") {
      operador = "igual";
      const sx = valor.toUpperCase().charAt(0);
      if (sx !== "M" && sx !== "F") return null;
      return {
        sourceKind: "paciente",
        sourceLocalId: null,
        variavel,
        operador,
        valor: sx,
        conector,
      };
    }
    if (variavel === "gestante") {
      const sim = /^s/i.test(valor) || /^true|1$/i.test(valor);
      return {
        sourceKind: "paciente",
        sourceLocalId: null,
        variavel,
        operador: "igual",
        valor: sim ? "Sim" : "Não",
        conector,
      };
    }
    if (variavel === "cid") {
      return {
        sourceKind: "paciente",
        sourceLocalId: null,
        variavel,
        operador: operador === "igual" ? "igual" : "contem",
        valor: valor.toUpperCase(),
        conector,
      };
    }
    if (!OPS_NUMERO.includes(operador) || num(valor) === undefined) return null;
    return {
      sourceKind: "paciente",
      sourceLocalId: null,
      variavel,
      operador,
      valor: String(num(valor)),
      conector,
    };
  }
  const src = str(c.sourceLocalId);
  if (kind === "medicamento") {
    if (tipoDe(src) !== "Medicamento") return null;
    return {
      sourceKind: "medicamento",
      sourceLocalId: src,
      estado: str(c.estado) === "suspenso" ? "suspenso" : "em_uso",
      conector,
    };
  }
  if (tipoDe(src) !== "Exame") return null;
  // a IA às vezes omite o campo: deduz pelo valor que veio
  const campo = str(c.campo) || (str(c.texto) ? "texto" : str(c.conceito) ? "achado" : "numero");
  if (campo === "achado") {
    const conceito = conceitoMaiusculo(c.conceito);
    if (!conceito) return null;
    return {
      sourceKind: "exame",
      sourceLocalId: src,
      campo,
      conceito,
      presente: c.presente !== false,
      conector,
    };
  }
  if (campo === "texto") {
    const texto = str(c.texto) || str(c.valor);
    const operador = OPS_TEXTO.includes(str(c.operador)) ? str(c.operador) : "contem";
    if (!texto) return null;
    return { sourceKind: "exame", sourceLocalId: src, campo, operador, texto, conector };
  }
  const operador = str(c.operador);
  if (!OPS_NUMERO.includes(operador)) return null;
  if (operador === "entre" || operador === "fora_de") {
    const a = num(c.numero_min);
    const b = num(c.numero_max);
    if (a === undefined || b === undefined) return null;
    return {
      sourceKind: "exame",
      sourceLocalId: src,
      campo: "numero",
      operador,
      numero_min: String(Math.min(a, b)),
      numero_max: String(Math.max(a, b)),
      conector,
    };
  }
  const n = numStr(c.numero);
  if (n === undefined) return null;
  return {
    sourceKind: "exame",
    sourceLocalId: src,
    campo: "numero",
    operador,
    numero: n,
    conector,
  };
}

function normEsquemas(v: unknown): Esquema[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e: any) => ({
      populacao: str(e?.populacao),
      dose: str(e?.dose),
      via: str(e?.via),
      posologia: str(e?.posologia),
      duracao: str(e?.duracao),
      dose_maxima: str(e?.dose_maxima),
    }))
    .filter((e) => e.dose || e.posologia)
    .slice(0, 12);
}

type HitTuss = { id: string; codigo_tuss: string; nome: string };
type HitSubstancia = { id_substancia: string; nome_exibicao: string };

// ---- correspondência com o catálogo -----------------------------------------

// Palavras que não identificam o exame ("Dosagem de creatinina sérica").
const VAZIAS_EXAME = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "na",
  "no",
  "para",
  "com",
  "por",
  "a",
  "o",
  "exame",
  "estudo",
  "dosagem",
  "pesquisa",
  "avaliacao",
  "determinacao",
  "serica",
  "serico",
  "sangue",
  "plasmatica",
  "plasmatico",
  "total",
]);
// Sais e partículas que não mudam o princípio ativo ("acetato de gosserrelina").
const VAZIAS_SUBSTANCIA = new Set([
  "de",
  "da",
  "do",
  "e",
  "acido",
  "cloridrato",
  "dicloridrato",
  "acetato",
  "sodico",
  "sodica",
  "dissodico",
  "potassico",
  "potassica",
  "calcico",
  "calcica",
  "magnesico",
  "mesilato",
  "dimesilato",
  "maleato",
  "succinato",
  "citrato",
  "fosfato",
  "sulfato",
  "tartarato",
  "hemitartarato",
  "besilato",
  "bromidrato",
  "fumarato",
  "hemifumarato",
  "monoidratado",
  "monoidratada",
  "di",
  "hidratado",
  "hidratada",
  "pamoato",
  "valerato",
  "propionato",
]);

function palavras(s: string, vazias: Set<string>): string[] {
  // "imuno-histoquímico" vira uma palavra só, como no catálogo
  return normKey(s.replace(/(\p{L})-(\p{L})/gu, "$1$2"))
    .split(" ")
    .filter((w) => w.length > 1 && !vazias.has(w));
}

/** Coeficiente de Dice por bigramas (0..1) — tolera grafias ("imunoistoquímica"). */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramas = (x: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < x.length - 1; i++)
      m.set(x.slice(i, i + 2), (m.get(x.slice(i, i + 2)) || 0) + 1);
    return m;
  };
  const A = bigramas(a);
  const B = bigramas(b);
  let inter = 0;
  A.forEach((v, k) => (inter += Math.min(v, B.get(k) || 0)));
  return (2 * inter) / (a.length + b.length - 2);
}

const cobertas = (de: string[], em: string[], min: number) =>
  de.filter((t) => em.some((u) => dice(t, u) >= min)).length;

/**
 * Nota (0..1) do nome do catálogo para o termo de exame; 0 = não é o mesmo
 * exame. A 1ª palavra significativa (o exame em si) tem que estar no nome do
 * catálogo — "Mamografia bilateral" não pode virar "Ultrassonografia mamária
 * bilateral" só porque "bilateral" bate.
 */
export function notaExame(termo: string, nomeCatalogo: string): number {
  const t = palavras(termo, VAZIAS_EXAME);
  const c = palavras(nomeCatalogo, VAZIAS_EXAME);
  if (!t.length || !c.length) return 0;
  if (!c.some((u) => dice(t[0], u) >= 0.7)) return 0;
  const nota = cobertas(t, c, 0.75) / t.length;
  // entre nomes válidos, prefere o mais enxuto (menos palavras extras)
  return nota >= 0.5 ? Math.max(0.01, nota - 0.01 * Math.max(0, c.length - t.length)) : 0;
}

/**
 * Nota (0..1) do nome do catálogo para o termo de medicamento: todas as
 * palavras dos dois lados precisam bater, senão é outro fármaco
 * ("Trastuzumabe" ≠ "Trastuzumabe entansina", "Abemaciclibe" ≠ "Palbociclibe").
 */
export function notaSubstancia(termo: string, nomeCatalogo: string): number {
  const t = palavras(termo, VAZIAS_SUBSTANCIA);
  const c = palavras(nomeCatalogo, VAZIAS_SUBSTANCIA);
  if (!t.length || !c.length) return 0;
  if (cobertas(t, c, 0.85) < t.length || cobertas(c, t, 0.85) < c.length) return 0;
  return normKey(termo) === normKey(nomeCatalogo) ? 1 : 0.9;
}

async function vincularExame(
  termos: string[],
  buscar: (termo: string, limite: number) => Promise<HitTuss[]>,
): Promise<{ hit: HitTuss | null; sugestao: HitTuss | null }> {
  let sugestao: HitTuss | null = null;
  const melhor = (hits: HitTuss[]) => {
    let top: { hit: HitTuss; nota: number } | null = null;
    for (const h of hits) {
      if (!sugestao) sugestao = h;
      const nota = Math.max(...termos.map((t) => notaExame(t, h.nome)));
      if (nota > 0 && (!top || nota > top.nota)) top = { hit: h, nota };
    }
    return top?.hit || null;
  };
  // 1) termo inteiro (nome e sinônimos)
  for (const t of termos) {
    const hit = melhor(await buscar(t, 10));
    if (hit) return { hit, sugestao };
  }
  // 2) palavra principal de cada termo — o catálogo costuma ter palavras no
  // meio ("Mamografia convencional bilateral") ou outra grafia
  // ("imunoistoquímica"), que a busca por trecho contínuo não acha.
  const chaves = new Set<string>();
  termos.forEach((t) => {
    const p = palavras(t, VAZIAS_EXAME).filter((w) => w.length >= 4);
    if (!p.length) return;
    chaves.add(p[0]);
    if (p[0].length > 8) chaves.add(p[0].slice(0, 6));
  });
  const vistos = new Map<string, HitTuss>();
  for (const k of chaves) (await buscar(k, 60)).forEach((h) => vistos.set(h.id, h));
  return { hit: melhor([...vistos.values()]), sugestao };
}

async function vincularSubstancia(
  termos: string[],
  buscar: (termo: string) => Promise<HitSubstancia[]>,
): Promise<{ hit: HitSubstancia | null; nota: number; sugestao: HitSubstancia | null }> {
  let sugestao: HitSubstancia | null = null;
  for (const t of termos) {
    let top: { hit: HitSubstancia; nota: number } | null = null;
    for (const h of await buscar(t)) {
      if (!sugestao) sugestao = h;
      const nota = notaSubstancia(t, h.nome_exibicao);
      if (nota > 0 && (!top || nota > top.nota)) top = { hit: h, nota };
    }
    if (top) return { ...top, sugestao };
  }
  return { hit: null, nota: 0, sugestao };
}

// ---- conectividade ------------------------------------------------------------

/**
 * Garante que o fluxo começa na Admissão e que nada fica solto:
 * - uma Admissão só (criada com os CIDs quando a IA não fez uma);
 * - Evento "suspender"/"ajustar" ligado direto a um exame/medicamento (ou
 *   solto) ganha uma Condição "Avaliar: …" na frente — sem ela o alerta
 *   dispararia sempre, não só quando o critério acontece;
 * - medicamento solto entra por uma Condição "Indicar: …" (2ª linha em diante
 *   ligada à linha anterior), para não ser prescrito a todos no dia 0;
 * - exame/consulta/condição soltos saem da Admissão.
 * Condições criadas aqui não têm critério avaliável: viram "Decidir" para o
 * médico na publicação.
 * Com `adicionando` (parte nova de um fluxo já aberto) não cria Admissão — o
 * Studio liga as raízes à Admissão que já está no canvas.
 */
export function amarrarFluxo(
  nodesIn: NoEstudio[],
  edgesIn: ArestaEstudio[],
  cids: string[],
  adicionando: boolean,
  novoId: (prefixo: string) => string,
): { nodes: NoEstudio[]; edges: ArestaEstudio[]; pendencias: string[] } {
  let nodes = [...nodesIn];
  let edges = edgesIn.map((e) => ({ ...e }));
  const pendencias: string[] = [];
  const porId = () => new Map(nodes.map((n) => [n.localId, n]));
  const ligar = (fromLocalId: string, fromHandle: string | null, toLocalId: string, lapso = 0) => {
    if (fromLocalId === toLocalId) return;
    if (
      edges.some(
        (e) =>
          e.fromLocalId === fromLocalId && e.fromHandle === fromHandle && e.toLocalId === toLocalId,
      )
    )
      return;
    edges.push({ fromLocalId, fromHandle, toLocalId, lapso });
  };
  const entradas = (id: string) => edges.filter((e) => e.toLocalId === id);

  // 1) Admissão única, sem nada chegando nela
  const adms = nodes.filter((n) => n.type === "Admissao");
  let adm: NoEstudio | null = adms[0] || null;
  if (adm && adms.length > 1) {
    const extras = new Set(adms.slice(1).map((n) => n.localId));
    edges.forEach((e) => {
      if (extras.has(e.fromLocalId)) e.fromLocalId = adm!.localId;
    });
    nodes = nodes.filter((n) => !extras.has(n.localId));
    pendencias.push(
      `O fluxo tinha ${adms.length} admissões — unificadas em "${adm.name}"; confira os critérios de entrada.`,
    );
  }
  if (!adm && !adicionando) {
    adm = {
      localId: novoId("admissao"),
      type: "Admissao",
      name: "Admissão no protocolo",
      clauses: cids.length
        ? [
            {
              sourceKind: "paciente",
              sourceLocalId: null,
              variavel: "cid",
              operador: "contem",
              valor: cids.join(", "),
              conector: null,
            },
          ]
        : [],
    };
    nodes.unshift(adm);
    pendencias.push(
      'A IA não criou a Admissão — criada "Admissão no protocolo" com os CIDs; todo o fluxo parte dela.',
    );
  }
  const ids = new Set(nodes.map((n) => n.localId));
  edges = edges.filter(
    (e) => ids.has(e.fromLocalId) && ids.has(e.toLocalId) && e.toLocalId !== adm?.localId,
  );

  const criarCondicao = (name: string, sim: string, nao: string): { id: string; sim: string } => {
    const id = novoId("cond_auto");
    nodes.push({
      localId: id,
      type: "Condicao",
      name,
      branches: [
        {
          localId: `${id}_sim`,
          isDefault: false,
          descricao: sim,
          clauses: [],
          repetir_gatilho_dias: null,
        },
        {
          localId: `${id}_nao`,
          isDefault: true,
          descricao: nao,
          clauses: [],
          repetir_gatilho_dias: null,
        },
      ],
    });
    return { id, sim: `${id}_sim` };
  };
  const daAdmissao = (id: string) => adm && ligar(adm.localId, "admitido", id, 0);

  // 2) Eventos amarrados por condicionais
  const eventosAmarrados: string[] = [];
  for (const ev of nodes.filter((n) => n.type === "Evento")) {
    const mapa = porId();
    const chegam = entradas(ev.localId);
    const diretas = chegam.filter((e) => mapa.get(e.fromLocalId)?.type !== "Condicao");
    const critico = ev.acao === "suspender" || ev.acao === "ajustar";
    const precisa = chegam.length
      ? critico && diretas.length > 0
      : !(ev.repetir_a_cada! > 0) || critico;
    const alvo = ev.alvoLocalId ? mapa.get(ev.alvoLocalId) : undefined;
    if (!precisa) {
      // alerta periódico solto (ex.: renovar LME): conta a partir do alvo
      if (!chegam.length) {
        if (alvo && alvo.type !== "Evento") ligar(alvo.localId, null, ev.localId, 0);
        else daAdmissao(ev.localId);
      }
      continue;
    }
    const cond = criarCondicao(
      `Avaliar: ${ev.name}`,
      ev.motivo || ev.conteudo || ev.name,
      "Manter conduta",
    );
    diretas.forEach((e) => (e.toLocalId = cond.id));
    if (!chegam.length) {
      if (alvo && alvo.type !== "Evento") ligar(alvo.localId, null, cond.id, 0);
      else daAdmissao(cond.id);
    }
    ligar(cond.id, cond.sim, ev.localId, 0);
    eventosAmarrados.push(ev.name);
  }
  // arestas que viraram duplicadas ao serem redirecionadas
  const vistas = new Set<string>();
  edges = edges.filter((e) => {
    const k = `${e.fromLocalId}|${e.fromHandle}|${e.toLocalId}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  if (eventosAmarrados.length)
    pendencias.push(
      `${eventosAmarrados.length} evento(s) estavam soltos ou sem critério e ganharam uma condição "Avaliar" (o médico decide quando aplicar): ${eventosAmarrados.join(", ")}. Se o documento der um limite de exame, troque por cláusula de exame.`,
    );

  // 3) Nós fora do caminho da Admissão
  const ligados: string[] = [];
  const indicados: string[] = [];
  for (let volta = 0; volta <= nodes.length; volta++) {
    const alcance = new Set<string>();
    const fila = adm
      ? [adm.localId]
      : nodes.filter((n) => !entradas(n.localId).length).map((n) => n.localId);
    while (fila.length) {
      const id = fila.shift()!;
      if (alcance.has(id)) continue;
      alcance.add(id);
      edges.forEach((e) => e.fromLocalId === id && fila.push(e.toLocalId));
    }
    const fora = nodes.filter((n) => !alcance.has(n.localId));
    // sem Admissão (modo "adicionar") só sobram ciclos; o Studio liga as raízes
    if (!fora.length || !adm) break;
    const raizes = fora.filter((n) => !entradas(n.localId).length);
    const lote = raizes.length ? raizes : [fora[0]];

    const grupos = new Map<string, NoEstudio[]>();
    for (const n of lote) {
      if (n.type === "Medicamento") {
        const g = (n.grupo_alternativa || "").trim();
        const k = `${n.linha_tratamento || 1}|${g || n.localId}`;
        (grupos.get(k) || grupos.set(k, []).get(k)!).push(n);
      } else {
        daAdmissao(n.localId);
        ligados.push(n.name);
      }
    }
    grupos.forEach((meds) => {
      const linha = meds[0].linha_tratamento || 1;
      const g = (meds[0].grupo_alternativa || "").trim();
      const titulo = meds.length > 1 && g ? g : meds[0].name;
      const crit = (meds[0].criterios_inclusao || []).slice(0, 2).join("; ");
      const cond = criarCondicao(
        `Indicar: ${titulo}${linha > 1 ? ` (${linha}ª linha)` : ""}`,
        linha > 1
          ? `Falha, progressão ou intolerância à ${linha - 1}ª linha${crit ? ` — ${crit}` : ""}`
          : `Indicado${crit ? `: ${crit}` : " para o paciente"}`,
        "Não indicado",
      );
      meds.forEach((m) => ligar(cond.id, cond.sim, m.localId, 0));
      const anterior =
        linha > 1
          ? nodes.find(
              (n) =>
                n.type === "Medicamento" && n.linha_tratamento === linha - 1 && !meds.includes(n),
            )
          : undefined;
      if (anterior) ligar(anterior.localId, null, cond.id, 0);
      else daAdmissao(cond.id);
      indicados.push(titulo);
    });
  }
  if (ligados.length)
    pendencias.push(
      `${ligados.length} nó(s) estavam fora do fluxo e foram ligados à Admissão: ${ligados.join(", ")}. Confira o momento (lapso) de cada um.`,
    );
  if (indicados.length)
    pendencias.push(
      `${indicados.length} medicamento(s)/grupo(s) estavam soltos e entraram por uma condição "Indicar" (decisão do médico): ${indicados.join(", ")}. Se depender de exame ou subtipo, ligue ao ramo correspondente.`,
    );

  return { nodes, edges, pendencias };
}

export async function gerarFluxoEstudioIA(opts: {
  apiKey: string;
  pdfBase64?: string | null;
  filename?: string | null;
  texto?: string | null;
  /** Fluxo já aberto no canvas, para gerar uma parte complementar sem repetir nós. */
  contexto?: string | null;
  /** Candidatos do catálogo TUSS para o termo (melhores primeiro). */
  buscarTuss: (termo: string, limite: number) => Promise<HitTuss[]>;
  /** Candidatos do catálogo de substâncias para o termo (genéricas ou não). */
  buscarSubstancia: (termo: string) => Promise<HitSubstancia[]>;
}): Promise<FluxoGerado> {
  const { apiKey, pdfBase64, filename, buscarTuss, buscarSubstancia } = opts;
  const texto = str(opts.texto);
  const contexto = str(opts.contexto);
  if (!texto && !pdfBase64) throw new ErroGeracaoProtocolo("Envie um PDF ou um texto.", 400);

  const partes = [
    texto
      ? `Instruções / texto do protocolo (prioridade sobre o documento):\n"""\n${texto}\n"""`
      : "Estruture o protocolo completo descrito no documento anexo: tratamento com todas as variações medicamentosas, monitorização com condutas e alertas.",
  ];
  if (contexto) {
    partes.push(
      `O canvas JÁ contém estes nós (não os repita; gere só o que falta e, se precisar ligar a eles, explique em observacoes_revisao):\n${contexto.slice(0, 6000)}`,
    );
  }
  const content: Array<Record<string, unknown>> = [{ type: "text", text: partes.join("\n\n") }];
  if (pdfBase64) {
    content.push({
      type: "file",
      file: {
        filename: filename || "protocolo.pdf",
        file_data: `data:application/pdf;base64,${pdfBase64}`,
      },
    });
  }

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("[estudio:gerar-ia] gateway", res.status, t.slice(0, 500));
    if (res.status === 429)
      throw new ErroGeracaoProtocolo(
        "Limite de uso da IA atingido. Tente novamente em instantes.",
        429,
      );
    if (res.status === 402) throw new ErroGeracaoProtocolo("Créditos de IA esgotados.", 402);
    if (res.status === 413)
      throw new ErroGeracaoProtocolo(
        "PDF grande demais para a IA. Envie só as seções de tratamento e monitorização.",
        413,
      );
    throw new ErroGeracaoProtocolo("Falha ao consultar a IA. Tente novamente.", 502);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  const spec = parseJsonStrict(choice?.message?.content || "");
  if (!spec) {
    if (choice?.finish_reason === "length") {
      throw new ErroGeracaoProtocolo(
        'O fluxo ficou grande demais para uma única geração. Gere por partes: escreva o foco (ex.: "somente tratamento pediátrico") e use "Adicionar ao fluxo atual".',
        422,
      );
    }
    throw new ErroGeracaoProtocolo(
      "A IA não devolveu um fluxo válido. Tente novamente ou detalhe o texto.",
      502,
    );
  }

  const pendencias: string[] = strList(spec.observacoes_revisao, 40);

  // ---- nós (1ª passada: tipos e ids, para validar referências depois) ------
  const brutos: any[] = Array.isArray(spec.nodes) ? spec.nodes : [];
  const usados = new Set<string>();
  const comTipo = brutos
    .map((n) => ({ n, type: normTipo(n?.type) }))
    .filter(({ n, type }) => {
      if (type) return true;
      pendencias.push(`Nó "${str(n?.name) || "?"}" com tipo desconhecido foi descartado.`);
      return false;
    })
    .map(({ n, type }) => {
      let id = str(n?.localId) || Math.random().toString(36).slice(2, 9);
      while (usados.has(id)) id += "_";
      usados.add(id);
      return { n, type: type as TipoNo, id, origId: str(n?.localId) };
    });
  // ids originais -> ids finais (só muda em caso de duplicata; a 1ª ocorrência vence)
  const idFinal = new Map<string, string>();
  comTipo.forEach((x) => {
    if (x.origId && !idFinal.has(x.origId)) idFinal.set(x.origId, x.id);
  });
  const tipoPorId = new Map(comTipo.map((x) => [x.id, x.type]));
  const resolve = (v: unknown) => idFinal.get(str(v)) || str(v);
  const tipoDe = (id: string) => tipoPorId.get(id);
  const nomeBrutoPorId = new Map(comTipo.map((x) => [x.id, str(x.n?.name)]));
  // exame citado pelo nome em vez do localId
  const exameDeNome = new Map<string, string>();
  comTipo.forEach((x) => {
    if (x.type === "Exame" && str(x.n?.name)) exameDeNome.set(normKey(str(x.n.name)), x.id);
  });
  // exames que a IA ligou em cada condição — fonte provável de uma cláusula de
  // exame com referência quebrada (ex.: subtipo por imuno-histoquímica)
  const examesQueEntram = new Map<string, Set<string>>();
  for (const e of Array.isArray(spec.edges) ? spec.edges : []) {
    const de = resolve(e?.fromLocalId);
    const para = resolve(e?.toLocalId);
    if (tipoDe(de) === "Exame" && tipoDe(para) === "Condicao")
      (examesQueEntram.get(para) || examesQueEntram.set(para, new Set()).get(para)!).add(de);
  }
  const fonteDaClausula = (c: Record<string, unknown>, condId: string | null): string => {
    const src = resolve(c?.sourceLocalId);
    const kind = str(c?.sourceKind);
    if (kind === "paciente" || kind === "medicamento" || tipoDe(src) === "Exame") return src;
    const porNome =
      exameDeNome.get(normKey(str(c?.sourceLocalId))) ||
      exameDeNome.get(normKey(str(c?.exame))) ||
      exameDeNome.get(normKey(str(c?.sourceName)));
    if (porNome) return porNome;
    const entram = condId ? examesQueEntram.get(condId) : undefined;
    return entram && entram.size === 1 ? [...entram][0] : src;
  };
  const resumoBruto = (c: Record<string, unknown>): string =>
    [
      str(c?.variavel) ||
        nomeBrutoPorId.get(resolve(c?.sourceLocalId)) ||
        str(c?.conceito) ||
        str(c?.sourceLocalId),
      str(c?.operador).replace(/_/g, " "),
      str(c?.valor) ||
        str(c?.texto) ||
        str(c?.numero) ||
        [str(c?.numero_min), str(c?.numero_max)].filter(Boolean).join("–"),
    ]
      .filter(Boolean)
      .join(" ");

  const nodes: NoEstudio[] = comTipo.map(({ n, type, id }) => {
    const name = str(n?.name) || type;
    const base: NoEstudio = { localId: id, type, name };
    const fixClauses = (arr: unknown, condId: string | null) => {
      const out: Clausula[] = [];
      const invalidas: string[] = [];
      (Array.isArray(arr) ? arr : []).forEach((c: any) => {
        const cc = normClausula(
          {
            ...c,
            sourceKind: str(c?.sourceKind) || "exame",
            sourceLocalId: fonteDaClausula(c, condId),
          },
          tipoDe,
        );
        if (cc) out.push(cc);
        else invalidas.push(resumoBruto(c) || "critério sem dados");
      });
      if (out.length) out[0] = { ...out[0], conector: null };
      return { clauses: out, invalidas };
    };
    if (type === "Admissao") {
      const { clauses, invalidas } = fixClauses(n?.clauses, null);
      if (invalidas.length)
        pendencias.push(
          `Admissão "${name}": critério(s) que o sistema não verifica foram removidos (${invalidas.join("; ")}) — confira a elegibilidade.`,
        );
      return { ...base, clauses };
    }
    if (type === "Exame")
      return { ...base, tussId: null, repetir_a_cada: diasNaoNeg(n?.repetir_a_cada) };
    if (type === "Consulta")
      return {
        ...base,
        especialidade: str(n?.especialidade),
        repetir_a_cada: diasNaoNeg(n?.repetir_a_cada),
      };
    if (type === "Medicamento") {
      const linha = num(n?.linha_tratamento);
      const esquemas = normEsquemas(n?.esquemas);
      if (!esquemas.length && (str(n?.dose) || str(n?.posologia))) {
        esquemas.push({
          populacao: "",
          dose: str(n?.dose),
          via: "",
          posologia: str(n?.posologia),
          duracao: "",
          dose_maxima: "",
        });
      }
      if (!esquemas.length)
        pendencias.push(`Medicamento "${name}" sem dose/posologia identificada no documento.`);
      return {
        ...base,
        substanciaId: null,
        linha_tratamento: linha && linha >= 1 ? Math.round(linha) : null,
        grupo_alternativa: str(n?.grupo_alternativa),
        ceaf: n?.ceaf === true,
        esquemas,
        criterios_inclusao: strList(n?.criterios_inclusao),
        criterios_exclusao: strList(n?.criterios_exclusao),
        contraindicacoes: strList(n?.contraindicacoes),
        ajuste_renal_hepatico: str(n?.ajuste_renal_hepatico),
        monitorizacao: str(n?.monitorizacao),
        repetir_a_cada: n?.repetir_a_cada === undefined ? 30 : diasNaoNeg(n?.repetir_a_cada),
      };
    }
    if (type === "Condicao") {
      const branches: NonNullable<NoEstudio["branches"]> = [];
      let temDefault = false;
      (Array.isArray(n?.branches) ? n.branches : []).forEach((b: any, i: number) => {
        const isDefault = !!b?.isDefault;
        const bId = str(b?.localId) || `${id}_b${i}`;
        const repete = num(b?.repetir_gatilho_dias);
        if (isDefault) {
          if (temDefault) {
            pendencias.push(
              `Condição "${name}" tinha mais de um caso padrão — mantido só o primeiro.`,
            );
            return;
          }
          temDefault = true;
          branches.push({
            localId: bId,
            isDefault: true,
            descricao: str(b?.descricao) || "Caso padrão",
            clauses: [],
            repetir_gatilho_dias: repete && repete > 0 ? Math.round(repete) : null,
          });
          return;
        }
        const { clauses, invalidas } = fixClauses(b?.clauses, id);
        const descricao = str(b?.descricao);
        // Critério que o motor não avalia (ou incompleto) não derruba o ramo:
        // ele fica sem cláusulas e vira uma opção da decisão do médico
        // ("Decidir") na publicação. Tirar só a cláusula ruim de um "E"
        // deixaria o ramo mais amplo do que o documento diz.
        if (invalidas.length || !clauses.length) {
          const criterio = invalidas.join(invalidas.length > 1 ? " E " : "");
          const rotulo =
            descricao && criterio && !normKey(descricao).includes(normKey(criterio))
              ? `${descricao} (${criterio})`
              : descricao || criterio || `Opção ${i + 1}`;
          pendencias.push(
            `Ramo "${rotulo}" da condição "${name}" usa critério que o sistema não avalia sozinho — vira escolha do médico ("Decidir") ao publicar.`,
          );
          branches.push({
            localId: bId,
            isDefault: false,
            descricao: rotulo,
            clauses: [],
            repetir_gatilho_dias: null,
          });
          return;
        }
        branches.push({
          localId: bId,
          isDefault: false,
          descricao,
          clauses,
          repetir_gatilho_dias: repete && repete > 0 ? Math.round(repete) : null,
        });
      });
      // O Studio espera o caso padrão como último ramo.
      const ordenados = [
        ...branches.filter((b) => !b.isDefault),
        ...branches.filter((b) => b.isDefault),
      ];
      if (!temDefault) {
        ordenados.push({
          localId: `${id}_padrao`,
          isDefault: true,
          descricao: "Caso padrão",
          clauses: [],
          repetir_gatilho_dias: null,
        });
        pendencias.push(
          `Condição "${name}" não tinha caso padrão — foi criado um vazio; decida o que fazer quando nenhum critério bater.`,
        );
      }
      return { ...base, branches: ordenados };
    }
    // Evento
    const acao = ACOES_EVENTO.includes(str(n?.acao)) ? str(n.acao) : "notificar_usuario";
    let alvo: string | null = n?.alvoLocalId ? resolve(n.alvoLocalId) : null;
    const tiposAlvo = ALVO_EVENTO[acao];
    if (alvo && (!tiposAlvo || !tiposAlvo.includes(tipoDe(alvo) as TipoNo))) {
      if (tiposAlvo)
        pendencias.push(
          `Evento "${name}" apontava para um alvo inválido — escolha o alvo no inspetor.`,
        );
      alvo = null;
    }
    if (tiposAlvo && !alvo) pendencias.push(`Evento "${name}" (${acao}) está sem nó alvo.`);
    const nivelK = normKey(str(n?.nivel)).replace(/\s/g, "");
    return {
      ...base,
      acao,
      alvoLocalId: alvo,
      motivo: str(n?.motivo),
      conteudo: str(n?.conteudo),
      destinatario:
        str(n?.destinatario) || (acao === "notificar_usuario" ? "Médico responsável" : ""),
      fator: str(n?.fator),
      repetir_a_cada: diasNaoNeg(n?.repetir_a_cada),
      nivel: (["info", "atencao", "critico"].includes(nivelK)
        ? nivelK
        : acao === "suspender"
          ? "critico"
          : "atencao") as NoEstudio["nivel"],
    };
  });

  // ---- arestas ---------------------------------------------------------------
  const porId = new Map(nodes.map((n) => [n.localId, n]));
  const edges: ArestaEstudio[] = [];
  const chave = (e: ArestaEstudio) => `${e.fromLocalId}|${e.fromHandle}|${e.toLocalId}`;
  const vistas = new Set<string>();
  const addEdge = (e: ArestaEstudio) => {
    if (vistas.has(chave(e))) return;
    vistas.add(chave(e));
    edges.push(e);
  };
  for (const e of Array.isArray(spec.edges) ? spec.edges : []) {
    const from = porId.get(resolve(e?.fromLocalId));
    const to = porId.get(resolve(e?.toLocalId));
    if (!from || !to || from === to) {
      pendencias.push("Uma conexão apontava para nó inexistente e foi removida.");
      continue;
    }
    let handle: string | null = null;
    if (from.type === "Admissao")
      handle = str(e?.fromHandle) === "nao_admitido" ? "nao_admitido" : "admitido";
    else if (from.type === "Condicao") {
      const h = str(e?.fromHandle);
      const branch =
        from.branches?.find((b) => b.localId === h) ||
        (normKey(h)
          ? from.branches?.find((b) => normKey(b.descricao).startsWith(normKey(h)))
          : undefined);
      if (!branch) {
        pendencias.push(
          `Conexão de "${from.name}" para "${to.name}" não indicava um ramo válido e foi removida.`,
        );
        continue;
      }
      handle = branch.localId;
    }
    addEdge({
      fromLocalId: from.localId,
      fromHandle: handle,
      toLocalId: to.localId,
      lapso: diasNaoNeg(e?.lapso),
    });
  }

  // As cláusulas de uma Condição só podem usar como fonte exames/medicamentos
  // que chegam nela por aresta (é assim que o inspetor do Studio lista as
  // fontes). Liga automaticamente o que a IA referenciou sem conectar.
  for (const n of nodes) {
    if (n.type !== "Condicao") continue;
    const fontes = new Set<string>();
    n.branches?.forEach((b) =>
      b.clauses.forEach((c) => c.sourceLocalId && fontes.add(c.sourceLocalId)),
    );
    fontes.forEach((src) => {
      if (!edges.some((e) => e.fromLocalId === src && e.toLocalId === n.localId)) {
        addEdge({ fromLocalId: src, fromHandle: null, toLocalId: n.localId, lapso: 0 });
      }
    });
  }

  // ---- CIDs (lista + cláusulas de CID da Admissão) --------------------------
  const cidsBrutos: unknown[] = Array.isArray(spec.cids) ? spec.cids : [];
  nodes
    .filter((n) => n.type === "Admissao")
    .forEach((n) =>
      n.clauses?.forEach((c) => {
        if (c.variavel === "cid") cidsBrutos.push(...str(c.valor).split(/[,;\s]+/));
      }),
    );
  const cids = [...new Set(cidsBrutos.map(normCid).filter((c): c is string => !!c))];
  if (!cids.length)
    pendencias.push(
      "Nenhum CID identificado — sem CID o protocolo publicado não é vinculado a nenhum paciente.",
    );

  // ---- tudo amarrado a partir da Admissão -----------------------------------
  const novoId = (prefixo: string) => {
    let id = prefixo;
    for (let i = 2; usados.has(id); i++) id = `${prefixo}${i}`;
    usados.add(id);
    return id;
  };
  const amarrado = amarrarFluxo(nodes, edges, cids, !!contexto, novoId);
  pendencias.push(...amarrado.pendencias);

  // ---- vínculo com o catálogo -----------------------------------------------
  // Só vincula quando o nome do catálogo corresponde de fato ao do documento:
  // exame vinculado errado faria a regra disparar com o resultado de outro
  // exame, e medicamento vinculado errado (abemaciclibe → palbociclibe)
  // prescreveria outro fármaco. Sem correspondência, fica para o inspetor.
  const sinonimos = new Map(comTipo.map(({ n, id }) => [id, strList(n?.sinonimos, 3)]));
  const pontuacaoSubstancia = new Map<string, number>();
  await emLotes(
    amarrado.nodes.filter((n) => n.type === "Exame" || n.type === "Medicamento"),
    6,
    async (no) => {
      const termos = [no.name, ...(sinonimos.get(no.localId) || [])];
      const original = no.name;
      try {
        if (no.type === "Exame") {
          const r = await vincularExame(termos, buscarTuss);
          if (!r.hit) {
            pendencias.push(
              `Exame "${original}" sem correspondência no catálogo TUSS${r.sugestao ? ` (mais próximo: "${r.sugestao.nome}", TUSS ${r.sugestao.codigo_tuss})` : ""} — vincule no inspetor.`,
            );
            return;
          }
          no.tussId = r.hit.id;
          no.codigoTuss = r.hit.codigo_tuss;
          if (r.hit.nome && normKey(r.hit.nome) !== normKey(original)) {
            no.name = r.hit.nome;
            no.nome_documento = original;
          }
        } else {
          const r = await vincularSubstancia(termos, buscarSubstancia);
          if (!r.hit) {
            pendencias.push(
              `Medicamento "${original}" não encontrado no catálogo de substâncias${r.sugestao ? ` (mais próximo: "${r.sugestao.nome_exibicao}", que é outro fármaco)` : ""} — vincule no inspetor.`,
            );
            return;
          }
          no.substanciaId = r.hit.id_substancia;
          pontuacaoSubstancia.set(no.localId, r.nota);
          if (r.hit.nome_exibicao && normKey(r.hit.nome_exibicao) !== normKey(original)) {
            no.name = r.hit.nome_exibicao;
            no.nome_documento = original;
          }
        }
      } catch {
        pendencias.push(`Falha ao buscar "${original}" no catálogo — vincule no inspetor.`);
      }
    },
  );
  // Dois fármacos diferentes do documento nunca dividem a mesma substância.
  const porSubstancia = new Map<string, NoEstudio[]>();
  amarrado.nodes.forEach((n) => {
    if (n.type === "Medicamento" && n.substanciaId)
      (
        porSubstancia.get(n.substanciaId) ||
        porSubstancia.set(n.substanciaId, []).get(n.substanciaId)!
      ).push(n);
  });
  porSubstancia.forEach((lista) => {
    const nomeDoc = (n: NoEstudio) => normKey(n.nome_documento || n.name);
    if (new Set(lista.map(nomeDoc)).size < 2) return;
    lista.sort(
      (a, b) =>
        (pontuacaoSubstancia.get(b.localId) || 0) - (pontuacaoSubstancia.get(a.localId) || 0),
    );
    const dono = nomeDoc(lista[0]);
    lista.slice(1).forEach((n) => {
      if (nomeDoc(n) === dono) return;
      pendencias.push(
        `"${n.nome_documento || n.name}" e "${lista[0].nome_documento || lista[0].name}" caíram na mesma substância do catálogo — o vínculo de "${n.nome_documento || n.name}" foi desfeito; vincule no inspetor.`,
      );
      n.substanciaId = null;
      if (n.nome_documento) {
        n.name = n.nome_documento;
        delete n.nome_documento;
      }
    });
  });

  const f = spec.fonte && typeof spec.fonte === "object" ? spec.fonte : {};
  return {
    name: str(spec.name) || "Fluxo gerado por IA",
    cids,
    fonte: {
      tipo_documento: str(f.tipo_documento) || (pdfBase64 ? "Documento" : "Instrução"),
      orgao: str(f.orgao),
      portaria: str(f.portaria),
      ano: str(f.ano),
      arquivo: str(filename),
    },
    nodes: amarrado.nodes,
    edges: amarrado.edges,
    pendencias: [...new Set(pendencias)],
  };
}
