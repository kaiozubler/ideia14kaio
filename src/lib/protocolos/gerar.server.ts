// IA dedicada à estruturação de protocolos assistenciais a partir de um PDF
// (PCDT, diretriz, artigo) e/ou instruções do médico.
//
// Segue o mesmo padrão de src/lib/exames/analise.server.ts: a IA nunca recebe
// o catálogo inteiro no prompt (ele é grande demais e muda com o tempo).
// Em vez disso, a IA devolve o NOME CLÍNICO CANÔNICO de cada exame/substância
// (ex: "Hemograma completo", "Enalapril") e sinônimos, e o servidor faz o
// cruzamento com as tabelas reais (tuss_procedimentos / substancias) via os
// callbacks buscarTuss/buscarSubstancia. Isso é o que garante que
// protocolo_acoes fique vinculado por FK, e não apenas com texto solto.
//
// Tudo que a IA devolve passa por normalização e validação aqui: o que não dá
// para executar com segurança no motor (supabase/migrations/
// 20261003120000_protocolos-pcdt-variacoes-alertas.sql) vira pendência de
// revisão humana, em vez de ser descartado em silêncio.

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const MODEL = "google/gemini-3.6-flash";
// PCDTs completos geram muitas ações (uma por fármaco, exame de monitorização
// e alerta); o limite padrão do gateway truncava o JSON no meio.
export const MAX_TOKENS = 32000;

export type TipoAcao = "Consulta" | "Exame" | "Receita" | "Alerta";

export type EsquemaDose = {
  populacao: string;
  dose: string;
  via: string;
  posologia: string;
  duracao: string;
  dose_maxima: string;
};

export type DetalhesReceita = {
  linha_tratamento: number | null;
  grupo_alternativa: string;
  esquemas: EsquemaDose[];
  criterios_inclusao: string[];
  criterios_exclusao: string[];
  contraindicacoes: string[];
  ajuste_renal_hepatico: string;
  monitorizacao: string;
  ceaf: boolean;
  nome_documento?: string;
};

export type DetalhesAlerta = {
  nivel: "info" | "atencao" | "critico";
  conduta: "suspender" | "ajustar" | "encaminhar" | "notificar" | "reavaliar";
  mensagem: string;
  medicamento_alvo: string;
};

export type CriterioPaciente = {
  idade_min?: number;
  idade_max?: number;
  sexo?: "F" | "M";
};

export type AcaoIA = {
  temp_id: string;
  tipo: TipoAcao;
  nome: string;
  especialidade: string;
  start_day: number;
  frequency: number;
  recurrent: boolean;
  auto_restart: boolean;
  descricao: string;
  regra_pai_temp_id: string | null;
  criterio_paciente: CriterioPaciente | null;
  detalhes: Partial<DetalhesReceita> | DetalhesAlerta | { nome_documento?: string };
  // preenchidos pelo servidor após a resposta da IA, nunca pela IA:
  tuss_procedimento_id: string | null;
  codigo_tuss: string | null;
  id_substancia: string | null;
  catalogo_status: "vinculado" | "pendente_cadastro" | "nao_aplicavel";
};

export type Operador =
  | "maior_que"
  | "menor_que"
  | "maior_ou_igual"
  | "menor_ou_igual"
  | "entre"
  | "fora_de"
  | "igual"
  | "contem";

export type Condicao = {
  campo: "numero" | "texto" | "achado";
  operador?: Operador;
  numero?: number;
  numero_min?: number;
  numero_max?: number;
  texto?: string;
  conceito?: string;
  presente?: boolean;
};

export type RegraIA = {
  temp_id: string;
  acao_gatilho_temp_id: string;
  descricao: string;
  condicao: Condicao | null;
  ordem: number;
  is_default: boolean;
  repete_gatilho_apos_dias: number | null;
};

export type FonteProtocolo = {
  tipo_documento: string;
  orgao: string;
  portaria: string;
  ano: string;
  arquivo: string;
};

export type ProtocoloGerado = {
  titulo: string;
  cids: string[];
  fonte: FonteProtocolo;
  acoes: AcaoIA[];
  regras: RegraIA[];
  pendencias: string[]; // avisos para revisão humana antes de publicar
};

const SYSTEM = `Você é um assistente clínico que transforma PCDTs (Protocolos Clínicos e Diretrizes
Terapêuticas do Ministério da Saúde), diretrizes de sociedades médicas e artigos em um protocolo
assistencial EXECUTÁVEL de acompanhamento contínuo: consultas, exames de monitorização, tratamento
medicamentoso com todas as suas variações, ramificações por resultado de exame e alertas automáticos.

COMO LER UM PCDT
PCDTs costumam ter as seções: CID-10 contemplados, diagnóstico, critérios de inclusão/exclusão,
casos especiais (gestantes, crianças, idosos, insuficiência renal/hepática), tratamento (fármacos,
esquemas de administração, tempo de tratamento, critérios de interrupção), monitorização (exames,
periodicidade, valores que exigem ajuste/suspensão) e acompanhamento pós-tratamento. Percorra TODAS
as seções — inclusive tabelas, quadros, fluxogramas e anexos — antes de responder.

Devolva APENAS um JSON válido no formato:
{
  "titulo": string,
  "cids": string[],
  "fonte": { "tipo_documento": "PCDT"|"Diretriz"|"Artigo"|"Instrução", "orgao": string, "portaria": string, "ano": string },
  "acoes": [
    {
      "temp_id": string,
      "tipo": "Consulta" | "Exame" | "Receita" | "Alerta",
      "nome": string,
      "sinonimos": string[],
      "especialidade": string,
      "start_day": number,
      "frequency": number,
      "recurrent": boolean,
      "auto_restart": boolean,
      "descricao": string,
      "regra_pai_temp_id": string | null,
      "criterio_paciente": { "idade_min"?: number, "idade_max"?: number, "sexo"?: "F"|"M" } | null,
      "medicamento": {                         // SOMENTE quando tipo = "Receita"
        "linha_tratamento": number | null,     // 1 = primeira linha, 2 = segunda...
        "grupo_alternativa": string,           // fármacos intercambiáveis compartilham o grupo (ex.: "IECA")
        "esquemas": [ { "populacao": string, "dose": string, "via": string, "posologia": string,
                        "duracao": string, "dose_maxima": string } ],
        "criterios_inclusao": string[],
        "criterios_exclusao": string[],
        "contraindicacoes": string[],
        "ajuste_renal_hepatico": string,
        "monitorizacao": string,
        "ceaf": boolean                        // dispensado pelo Componente Especializado (exige LME)
      },
      "alerta": {                              // SOMENTE quando tipo = "Alerta"
        "nivel": "info" | "atencao" | "critico",
        "conduta": "suspender" | "ajustar" | "encaminhar" | "notificar" | "reavaliar",
        "mensagem": string,
        "medicamento_alvo": string
      }
    }
  ],
  "regras": [
    {
      "temp_id": string,
      "acao_gatilho_temp_id": string,
      "descricao": string,
      "condicao": {
        "campo": "numero" | "texto" | "achado",
        "operador"?: "maior_que" | "menor_que" | "maior_ou_igual" | "menor_ou_igual" | "entre" | "fora_de" | "igual" | "contem",
        "numero"?: number, "numero_min"?: number, "numero_max"?: number,
        "texto"?: string,
        "conceito"?: string, "presente"?: boolean
      } | null,
      "ordem": number,
      "is_default": boolean,
      "repete_gatilho_apos_dias": number | null
    }
  ],
  "observacoes_revisao": string[]
}

TRATAMENTO MEDICAMENTOSO — TODAS AS VARIAÇÕES
- Crie UMA ação "Receita" por fármaco (princípio ativo) citado no tratamento. Nunca agrupe vários
  fármacos numa ação só e nunca omita alternativas da mesma linha.
- Variações de dose do MESMO fármaco (adulto x pediátrico, por kg, ataque x manutenção, titulação,
  insuficiência renal) vão em "medicamento.esquemas" — um item por variação, com "populacao"
  descrevendo a quem se aplica (ex.: "Adulto", "Criança 6-12 anos (por kg)", "Ataque — semana 1-4",
  "TFG < 30 mL/min").
- Linhas de tratamento: fármacos de 1ª linha são ações raiz (sem regra_pai_temp_id). Fármacos de 2ª/3ª
  linha, quando o PCDT condiciona a troca a um resultado de exame (ex.: "HbA1c ≥ 7% após 3 meses"),
  ficam no ramo da regra correspondente. Quando a troca depende de critério clínico não mensurável
  (intolerância, falha terapêutica avaliada em consulta), mantenha o fármaco como ação raiz com o
  "linha_tratamento" correto, recurrent = false, e crie uma ação "Alerta" de reavaliação no prazo
  definido pelo documento.
- Fármacos que são alternativas entre si (o médico escolhe um) compartilham "grupo_alternativa".
- Fármacos restritos a uma população usam "criterio_paciente" (ex.: só crianças → idade_max: 17).
- start_day/frequency de uma Receita = renovação da receita (ex.: 30, 60, 90 ou 180 dias, conforme o
  documento ou a regra de dispensação; use 30 quando nada for dito para medicamento de uso contínuo).

MONITORIZAÇÃO E RAMIFICAÇÕES
- Cada exame de monitorização é uma ação "Exame" com sua periodicidade. Quando o documento disser o
  que fazer conforme o resultado, crie "regras" para esse exame.
- start_day é relativo ao início do protocolo para ações raiz, e relativo à data do resultado para
  ações COM regra_pai_temp_id (normalmente 0).
- Toda ação com regra_pai_temp_id deve apontar para um "regras[].temp_id" existente; toda regra deve
  apontar para um "acoes[].temp_id" do tipo Exame existente. Uma ação de ramo também pode ser um Exame
  com suas próprias regras (ramo dentro de ramo).
- Todo exame com ramificação deve ter, entre suas regras, exatamente uma com is_default = true.
- Para "repetir o mesmo exame a cada N dias" dentro de um ramo, NÃO duplique a ação: preencha
  "repete_gatilho_apos_dias" na regra; e então o exame raiz deve ter recurrent = false.
- Operadores: use exatamente o limite do texto. "≥ 7%" → maior_ou_igual 7; "> 3x LSN" → registre o valor
  absoluto quando o documento der o LSN, senão use campo "achado" com conceito em MAIÚSCULAS
  (ex.: "TGO_ACIMA_3X_LSN", presente: true); "entre 140 e 159" → entre; "fora da faixa X–Y" → fora_de.
- Resultados qualitativos ("reagente", "positivo", "detectável") → campo "texto" com operador "contem".

ALERTAS (AUTOMAÇÕES)
- Use ações "Alerta" para tudo que o PCDT manda o médico FAZER ou VERIFICAR e que não é um exame,
  consulta ou receita: suspender/ajustar fármaco por toxicidade, encaminhar a especialista, renovar
  LME/laudo do CEAF, reavaliar resposta ao tratamento no prazo, tempo máximo de tratamento, critérios
  de interrupção, notificação compulsória.
- Alerta de toxicidade/resultado fica no ramo da regra do exame que o dispara (start_day 0, nivel
  "critico" para suspensão). Alerta de prazo (reavaliar em 12 semanas, renovar LME a cada 3 meses) é
  ação raiz com start_day/frequency do prazo.
- "alerta.mensagem" diz objetivamente o que fazer; "alerta.medicamento_alvo" é o fármaco afetado.

POPULAÇÃO E CASOS ESPECIAIS
- "criterio_paciente" só aceita idade e sexo, que o sistema verifica automaticamente. Critérios que o
  sistema não consegue verificar (gestação, peso, função renal sem exame, comorbidades) devem ir em
  "medicamento.criterios_inclusao/exclusao" ou num Alerta, e ser citados em "observacoes_revisao".

NOMES (CRÍTICO PARA A VINCULAÇÃO COM O CATÁLOGO)
- Exame: NOME CLÍNICO OFICIAL, curto e pesquisável (ex.: "Hemograma completo", "Creatinina sérica",
  "Hemoglobina glicada", "TGO (AST)"). Nunca uma lista de exames num item — quebre em várias ações.
  Em "sinonimos", até 3 nomes alternativos (ex.: ["HbA1c", "Glico-hemoglobina"]).
- Receita: princípio ativo em português, sem dose e sem nome comercial (ex.: "Metformina",
  "Losartana potássica"). Em "sinonimos", grafias alternativas do mesmo princípio ativo.
- CIDs: liste TODOS os códigos CID-10 contemplados pelo documento, no formato "E10.0" (com ponto) ou
  "E10" (categoria).

GERAL
- Nunca invente exames, medicamentos, doses ou limites que não estejam explícitos ou claramente
  implícitos no documento/instruções. Se o documento for ambíguo, registre em "observacoes_revisao".
- "descricao" é um resumo seu, curto — nunca copie parágrafos do documento.
- Instruções do médico têm prioridade sobre o documento quando conflitarem.
- Nunca inclua texto fora do JSON.`;

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

export function strList(v: unknown, max = 20): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : [];
}

export function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function intNonNeg(v: unknown, fallback: number): number {
  const n = num(v);
  return n === undefined ? fallback : Math.max(0, Math.round(n));
}

export function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sobreposição de palavras (0..1) — usada só para sinalizar vínculo duvidoso. */
export function similaridade(a: string, b: string): number {
  const ta = new Set(
    normKey(a)
      .split(" ")
      .filter((w) => w.length > 1),
  );
  const tb = new Set(
    normKey(b)
      .split(" ")
      .filter((w) => w.length > 1),
  );
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((w) => {
    if (tb.has(w)) inter++;
  });
  return inter / Math.min(ta.size, tb.size);
}

export function parseJsonStrict(text: string): Record<string, any> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" ? v : null;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const v = JSON.parse(m[0]);
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  }
}

const TIPOS_ACAO: TipoAcao[] = ["Consulta", "Exame", "Receita", "Alerta"];
function normTipo(v: unknown): TipoAcao {
  const t = normKey(str(v));
  if (/medicament|farmac|prescri/.test(t)) return "Receita";
  if (/aviso|notifica|automac/.test(t)) return "Alerta";
  const hit = TIPOS_ACAO.find((x) => x.toLowerCase() === t);
  return hit || "Exame";
}

const OPERADORES: Operador[] = [
  "maior_que",
  "menor_que",
  "maior_ou_igual",
  "menor_ou_igual",
  "entre",
  "fora_de",
  "igual",
  "contem",
];

/** Normaliza a condição para o formato que public.avaliar_condicao entende; null = inválida. */
function normCondicao(c: any): Condicao | null {
  if (!c || typeof c !== "object") return null;
  const campo = str(c.campo);
  if (campo === "achado") {
    const conceito = str(c.conceito)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    if (!conceito) return null;
    return { campo: "achado", conceito, presente: c.presente !== false };
  }
  const operador = str(c.operador) as Operador;
  if (!OPERADORES.includes(operador)) return null;
  if (campo === "texto") {
    const texto = str(c.texto);
    if (!texto || (operador !== "igual" && operador !== "contem")) return null;
    return { campo: "texto", operador, texto };
  }
  if (campo !== "numero") return null;
  if (operador === "entre" || operador === "fora_de") {
    const a = num(c.numero_min);
    const b = num(c.numero_max);
    if (a === undefined || b === undefined) return null;
    return { campo: "numero", operador, numero_min: Math.min(a, b), numero_max: Math.max(a, b) };
  }
  if (operador === "contem") return null;
  const n = num(c.numero);
  if (n === undefined) return null;
  return { campo: "numero", operador, numero: n };
}

function normCriterio(c: any): CriterioPaciente | null {
  if (!c || typeof c !== "object") return null;
  const out: CriterioPaciente = {};
  const min = num(c.idade_min);
  const max = num(c.idade_max);
  if (min !== undefined && min > 0) out.idade_min = Math.round(min);
  if (max !== undefined && max < 130) out.idade_max = Math.round(max);
  const sx = str(c.sexo).toUpperCase().charAt(0);
  if (sx === "F" || sx === "M") out.sexo = sx;
  return Object.keys(out).length ? out : null;
}

function normEsquemas(v: unknown): EsquemaDose[] {
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

function normDetalhesReceita(m: any): DetalhesReceita {
  const linha = num(m?.linha_tratamento);
  return {
    linha_tratamento: linha && linha >= 1 ? Math.round(linha) : null,
    grupo_alternativa: str(m?.grupo_alternativa),
    esquemas: normEsquemas(m?.esquemas),
    criterios_inclusao: strList(m?.criterios_inclusao),
    criterios_exclusao: strList(m?.criterios_exclusao),
    contraindicacoes: strList(m?.contraindicacoes),
    ajuste_renal_hepatico: str(m?.ajuste_renal_hepatico),
    monitorizacao: str(m?.monitorizacao),
    ceaf: m?.ceaf === true,
  };
}

const NIVEIS = ["info", "atencao", "critico"] as const;
const CONDUTAS = ["suspender", "ajustar", "encaminhar", "notificar", "reavaliar"] as const;
function normDetalhesAlerta(a: any, descricao: string): DetalhesAlerta {
  const nivel = normKey(str(a?.nivel)).replace(" ", "");
  const conduta = normKey(str(a?.conduta));
  return {
    nivel: (NIVEIS as readonly string[]).includes(nivel)
      ? (nivel as DetalhesAlerta["nivel"])
      : "atencao",
    conduta: (CONDUTAS as readonly string[]).includes(conduta)
      ? (conduta as DetalhesAlerta["conduta"])
      : "notificar",
    mensagem: str(a?.mensagem) || descricao,
    medicamento_alvo: str(a?.medicamento_alvo),
  };
}

export function normCid(v: unknown): string | null {
  const raw = str(v).toUpperCase().replace(/\s+/g, "");
  const m = raw.match(/^([A-Z])(\d{2})\.?(\d{1,2})?$/);
  if (!m) return null;
  return m[3] ? `${m[1]}${m[2]}.${m[3]}` : `${m[1]}${m[2]}`;
}

/** Executa fn em lotes pequenos para não abrir dezenas de RPCs simultâneas. */
export async function emLotes<T>(itens: T[], tamanho: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < itens.length; i += tamanho) {
    await Promise.all(itens.slice(i, i + tamanho).map(fn));
  }
}

type HitTuss = { id: string; codigo_tuss: string; nome: string };
type HitSubstancia = { id_substancia: string; nome_exibicao: string };

export class ErroGeracaoProtocolo extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function gerarProtocoloIA(opts: {
  apiKey: string;
  pdfBase64?: string | null;
  filename?: string | null;
  observacao?: string | null;
  /** Resolve o nome de um exame no catálogo oficial (tuss_procedimentos). */
  buscarTuss: (termo: string) => Promise<HitTuss | null>;
  /** Resolve o nome de uma substância no catálogo oficial (substancias). */
  buscarSubstancia: (termo: string) => Promise<HitSubstancia | null>;
}): Promise<ProtocoloGerado> {
  const { apiKey, pdfBase64, filename, observacao, buscarTuss, buscarSubstancia } = opts;
  const obs = str(observacao);
  if (!obs && !pdfBase64) throw new ErroGeracaoProtocolo("Envie um PDF ou uma observação.", 400);

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: obs
        ? `Instruções do médico (prioridade sobre o documento):\n${obs}`
        : "Estruture o protocolo assistencial completo descrito no documento anexo, com todas as variações medicamentosas, monitorização e alertas.",
    },
  ];
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
    console.error("[protocolos:gerar-ia] gateway", res.status, t.slice(0, 500));
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
  const parsed = parseJsonStrict(choice?.message?.content || "");
  if (!parsed) {
    if (choice?.finish_reason === "length") {
      throw new ErroGeracaoProtocolo(
        'O protocolo ficou grande demais para uma única geração. Nas instruções, peça para focar em uma parte (ex.: "somente adultos" ou "somente tratamento e monitorização") e gere o restante depois — as ações são somadas ao protocolo aberto.',
        422,
      );
    }
    throw new ErroGeracaoProtocolo(
      "A IA não devolveu um protocolo válido. Tente novamente ou detalhe as instruções.",
      502,
    );
  }

  const pendencias: string[] = strList(parsed.observacoes_revisao, 40);

  // ---- ações ----------------------------------------------------------------
  const vistos = new Set<string>();
  const acoes: AcaoIA[] = (Array.isArray(parsed.acoes) ? parsed.acoes : [])
    .map((x: any) => {
      const tipo = normTipo(x?.tipo);
      const descricao = str(x?.descricao);
      let temp = str(x?.temp_id) || Math.random().toString(36).slice(2, 9);
      while (vistos.has(temp)) temp += "_";
      vistos.add(temp);
      const acao: AcaoIA = {
        temp_id: temp,
        tipo,
        nome: str(x?.nome),
        especialidade: str(x?.especialidade),
        start_day: intNonNeg(x?.start_day, 0),
        frequency: intNonNeg(x?.frequency, tipo === "Receita" ? 30 : 90),
        recurrent: x?.recurrent !== false,
        auto_restart: !!x?.auto_restart,
        descricao,
        regra_pai_temp_id: x?.regra_pai_temp_id ? str(x.regra_pai_temp_id) : null,
        criterio_paciente: normCriterio(x?.criterio_paciente),
        detalhes:
          tipo === "Receita"
            ? normDetalhesReceita(x?.medicamento)
            : tipo === "Alerta"
              ? normDetalhesAlerta(x?.alerta, descricao)
              : {},
        tuss_procedimento_id: null,
        codigo_tuss: null,
        id_substancia: null,
        catalogo_status: "nao_aplicavel",
      };
      if (acao.frequency === 0) acao.recurrent = false;
      (acao as AcaoIA & { _sinonimos: string[] })._sinonimos = strList(x?.sinonimos, 3);
      return acao;
    })
    .filter((a: AcaoIA) => a.nome);

  // ---- regras ---------------------------------------------------------------
  const porTemp = new Map(acoes.map((a) => [a.temp_id, a]));
  const regras: RegraIA[] = [];
  for (const r of Array.isArray(parsed.regras) ? parsed.regras : []) {
    const gatilho = porTemp.get(str(r?.acao_gatilho_temp_id));
    const descricao = str(r?.descricao);
    if (!gatilho) {
      pendencias.push(
        `Regra "${descricao || "sem descrição"}" ignorada: o exame que a dispara não foi identificado.`,
      );
      continue;
    }
    if (gatilho.tipo !== "Exame") {
      pendencias.push(
        `Regra "${descricao}" ignorada: só resultados de exame disparam ramificações (gatilho "${gatilho.nome}" é ${gatilho.tipo}).`,
      );
      continue;
    }
    const isDefault = !!r?.is_default;
    const condicao = isDefault ? null : normCondicao(r?.condicao);
    if (!isDefault && !condicao) {
      pendencias.push(
        `Regra "${descricao}" do exame "${gatilho.nome}" tem condição que o sistema não consegue avaliar — revise o limite antes de salvar.`,
      );
      continue;
    }
    const repete = num(r?.repete_gatilho_apos_dias);
    regras.push({
      temp_id: str(r?.temp_id) || Math.random().toString(36).slice(2, 9),
      acao_gatilho_temp_id: gatilho.temp_id,
      descricao,
      condicao,
      ordem: intNonNeg(r?.ordem, regras.length),
      is_default: isDefault,
      repete_gatilho_apos_dias: repete && repete > 0 ? Math.round(repete) : null,
    });
  }

  // Mais de um caso padrão no mesmo exame: o motor usaria só o primeiro.
  const defaultsPorGatilho = new Map<string, number>();
  regras.forEach((r) => {
    if (r.is_default)
      defaultsPorGatilho.set(
        r.acao_gatilho_temp_id,
        (defaultsPorGatilho.get(r.acao_gatilho_temp_id) || 0) + 1,
      );
  });

  const regrasPorTemp = new Map(regras.map((r) => [r.temp_id, r]));
  for (const a of acoes) {
    // Ação de ramo cuja regra não existe vira ação raiz (antes ela sumia).
    if (a.regra_pai_temp_id && !regrasPorTemp.has(a.regra_pai_temp_id)) {
      pendencias.push(
        `"${a.nome}" pertencia a uma ramificação inválida e foi colocada no fluxo principal — confira quando ela deve acontecer.`,
      );
      a.regra_pai_temp_id = null;
    }
    if (a.regra_pai_temp_id) {
      a.recurrent = false;
      a.frequency = 0;
    }
  }

  // Ciclos (A dispara regra que cria B que dispara regra que cria A) não são
  // executáveis: quebra o vínculo do primeiro elo que fecha o ciclo.
  for (const a of acoes) {
    const visit = new Set<string>([a.temp_id]);
    let cur: AcaoIA | undefined = a;
    while (cur?.regra_pai_temp_id) {
      const pai = regrasPorTemp.get(cur.regra_pai_temp_id);
      const gat = pai ? porTemp.get(pai.acao_gatilho_temp_id) : undefined;
      if (!gat) break;
      if (visit.has(gat.temp_id)) {
        pendencias.push(
          `Ramificação circular envolvendo "${a.nome}" foi desfeita — revise a sequência.`,
        );
        a.regra_pai_temp_id = null;
        break;
      }
      visit.add(gat.temp_id);
      cur = gat;
    }
  }

  for (const [gat, n] of defaultsPorGatilho) {
    if (n > 1)
      pendencias.push(
        `O exame "${porTemp.get(gat)?.nome}" tem ${n} casos padrão — mantenha só um.`,
      );
  }
  for (const a of acoes) {
    if (a.tipo !== "Exame") continue;
    const rs = regras.filter((r) => r.acao_gatilho_temp_id === a.temp_id);
    if (!rs.length) continue;
    if (!rs.some((r) => r.is_default)) {
      pendencias.push(
        `O exame "${a.nome}" tem ramificações sem "caso padrão" — resultados fora das faixas não gerarão conduta.`,
      );
    }
    if (a.recurrent && rs.some((r) => r.repete_gatilho_apos_dias)) {
      // repetição passa a ser controlada pelas regras; evita exame em dobro
      a.recurrent = false;
    }
  }

  for (const a of acoes) {
    if (a.tipo === "Receita") {
      const d = a.detalhes as DetalhesReceita;
      if (!d.esquemas.length)
        pendencias.push(`Medicamento "${a.nome}" sem dose/posologia identificada no documento.`);
    }
    if (a.tipo === "Alerta" && !(a.detalhes as DetalhesAlerta).mensagem) {
      pendencias.push(`Alerta "${a.nome}" sem mensagem de conduta.`);
    }
  }

  // ---- vínculo com o catálogo -----------------------------------------------
  // Tenta o nome e os sinônimos; o primeiro que achar vence. Vínculo com pouca
  // sobreposição de palavras fica marcado para conferência — um exame
  // vinculado errado faria a regra disparar com o resultado de outro exame.
  await emLotes(acoes, 6, async (acao) => {
    const termos = [acao.nome, ...((acao as AcaoIA & { _sinonimos?: string[] })._sinonimos || [])];
    delete (acao as AcaoIA & { _sinonimos?: string[] })._sinonimos;
    if (acao.tipo !== "Exame" && acao.tipo !== "Receita") return;
    const nomeDocumento = acao.nome;
    try {
      if (acao.tipo === "Exame") {
        let hit: HitTuss | null = null;
        for (const t of termos) {
          hit = await buscarTuss(t);
          if (hit) break;
        }
        if (!hit) {
          acao.catalogo_status = "pendente_cadastro";
          pendencias.push(
            `Exame "${nomeDocumento}" não encontrado no catálogo TUSS — vincular manualmente.`,
          );
          return;
        }
        acao.tuss_procedimento_id = hit.id;
        acao.codigo_tuss = hit.codigo_tuss;
        acao.catalogo_status = "vinculado";
        if (hit.nome && normKey(hit.nome) !== normKey(nomeDocumento)) {
          acao.nome = hit.nome;
          acao.detalhes = { ...acao.detalhes, nome_documento: nomeDocumento };
          if (Math.max(...termos.map((t) => similaridade(t, hit!.nome))) < 0.5) {
            pendencias.push(
              `Confira o vínculo: "${nomeDocumento}" foi associado a "${hit.nome}" (TUSS ${hit.codigo_tuss}).`,
            );
          }
        }
      } else {
        let hit: HitSubstancia | null = null;
        for (const t of termos) {
          hit = await buscarSubstancia(t);
          if (hit) break;
        }
        if (!hit) {
          acao.catalogo_status = "pendente_cadastro";
          pendencias.push(
            `Medicamento "${nomeDocumento}" não encontrado no catálogo de substâncias — vincular manualmente.`,
          );
          return;
        }
        acao.id_substancia = hit.id_substancia;
        acao.catalogo_status = "vinculado";
        if (hit.nome_exibicao && normKey(hit.nome_exibicao) !== normKey(nomeDocumento)) {
          acao.nome = hit.nome_exibicao;
          acao.detalhes = { ...acao.detalhes, nome_documento: nomeDocumento };
          if (Math.max(...termos.map((t) => similaridade(t, hit!.nome_exibicao))) < 0.5) {
            pendencias.push(
              `Confira o vínculo: "${nomeDocumento}" foi associado a "${hit.nome_exibicao}".`,
            );
          }
        }
      }
    } catch {
      acao.catalogo_status = "pendente_cadastro";
      pendencias.push(`Falha ao buscar "${nomeDocumento}" no catálogo — vincular manualmente.`);
    }
  });

  // ---- CIDs -----------------------------------------------------------------
  const cidsBrutos = Array.isArray(parsed.cids) ? parsed.cids : [];
  const cids = [...new Set(cidsBrutos.map(normCid).filter((c: string | null): c is string => !!c))];
  const invalidos = cidsBrutos.map(str).filter((c: string) => c && !normCid(c));
  if (invalidos.length)
    pendencias.push(
      `CIDs em formato não reconhecido foram ignorados: ${invalidos.slice(0, 8).join(", ")}.`,
    );
  if (!cids.length)
    pendencias.push(
      "Nenhum CID identificado — sem CID o protocolo não é vinculado a nenhum paciente.",
    );

  const f = parsed.fonte && typeof parsed.fonte === "object" ? parsed.fonte : {};
  return {
    titulo: str(parsed.titulo) || "Protocolo sem título",
    cids,
    fonte: {
      tipo_documento: str(f.tipo_documento) || (pdfBase64 ? "Documento" : "Instrução"),
      orgao: str(f.orgao),
      portaria: str(f.portaria),
      ano: str(f.ano),
      arquivo: str(filename),
    },
    acoes,
    regras,
    pendencias: [...new Set(pendencias)],
  };
}
