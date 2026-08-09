// IA dedicada à estruturação de protocolos assistenciais a partir de um PDF
// (diretriz/PCDT) e/ou instruções do médico.
//
// Segue o mesmo padrão de src/lib/exames/analise.server.ts: a IA nunca recebe
// o catálogo inteiro no prompt (ele é grande demais e muda com o tempo).
// Em vez disso, a IA devolve o NOME CLÍNICO CANÔNICO de cada exame/substância
// (ex: "Hemograma completo", "Enalapril"), e o servidor faz o cruzamento com
// as tabelas reais (tuss_procedimentos / substancias) via os callbacks
// buscarTuss/buscarSubstancia — exatamente como já é feito para exames.
// Isso é o que garante que protocolo_acoes fique vinculado por FK, e não
// apenas com texto solto.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

export type AcaoIA = {
  temp_id: string;
  tipo: "Consulta" | "Exame" | "Receita";
  nome: string;
  especialidade: string;
  start_day: number;
  frequency: number;
  recurrent: boolean;
  auto_restart: boolean;
  descricao: string;
  regra_pai_temp_id: string | null;
  // preenchidos pelo servidor após a resposta da IA, nunca pela IA:
  tuss_procedimento_id: string | null;
  codigo_tuss: string | null;
  id_substancia: string | null;
  catalogo_status: "vinculado" | "pendente_cadastro" | "nao_aplicavel";
};

export type RegraIA = {
  temp_id: string;
  acao_gatilho_temp_id: string;
  descricao: string;
  condicao: {
    campo: "numero" | "texto";
    operador: "maior_que" | "menor_que" | "entre" | "igual" | "contem";
    numero?: number;
    numero_min?: number;
    numero_max?: number;
    texto?: string;
  } | null;
  ordem: number;
  is_default: boolean;
  repete_gatilho_apos_dias: number | null;
};

export type ProtocoloGerado = {
  titulo: string;
  cids: string[];
  acoes: AcaoIA[];
  regras: RegraIA[];
  pendencias: string[]; // avisos para revisão humana antes de publicar
};

const SYSTEM = `Você é um assistente clínico que estrutura protocolos assistenciais de acompanhamento
contínuo a partir de PCDTs, diretrizes e artigos, incluindo eventuais ramificações por resultado de
exame (ex: "se o exame X vier alterado, ajustar medicação e repetir em 30 dias; se normal, monitorar
e repetir em 60 dias").

A partir do documento e/ou das instruções recebidas, devolva APENAS um JSON válido no formato:
{
  "titulo": string,
  "cids": string[],
  "acoes": [
    {
      "temp_id": string,
      "tipo": "Consulta" | "Exame" | "Receita",
      "nome": string,
      "especialidade": string,
      "start_day": number,
      "frequency": number,
      "recurrent": boolean,
      "auto_restart": boolean,
      "descricao": string,
      "regra_pai_temp_id": string | null
    }
  ],
  "regras": [
    {
      "temp_id": string,
      "acao_gatilho_temp_id": string,
      "descricao": string,
      "condicao": {
        "campo": "numero" | "texto",
        "operador": "maior_que" | "menor_que" | "entre" | "igual" | "contem",
        "numero"?: number,
        "numero_min"?: number,
        "numero_max"?: number,
        "texto"?: string
      } | null,
      "ordem": number,
      "is_default": boolean,
      "repete_gatilho_apos_dias": number | null
    }
  ]
}

REGRAS DE PREENCHIMENTO
- start_day é relativo ao início do protocolo para ações sem regra_pai_temp_id, e relativo à data do
  resultado que disparou a regra para ações COM regra_pai_temp_id (que geralmente devem ter start_day = 0).
- Toda ação com regra_pai_temp_id preenchido deve corresponder a uma "regras[].temp_id" existente.
- Toda ação de Exame que tem ramificação deve ter, entre suas regras associadas, pelo menos uma com
  is_default = true.
- Para "repetir o mesmo exame a cada N dias" dentro de um ramo, NÃO duplique a ação — preencha
  "repete_gatilho_apos_dias" na regra do ramo.
- Ações sem ramificação ficam sem regra_pai_temp_id (ou null) e sem regra associada.
- Uma condição numérica com faixa fechada (ex.: "PAS entre 140 e 159") usa operador "entre" com
  numero_min/numero_max. Uma faixa aberta para cima (ex.: "PAS ≥ 180") usa "maior_que" com o limite
  inferior menos 1, OU simplesmente numero = 179 com operador maior_que quando o texto disser "≥ 180"
  — escolha o operador que reproduza fielmente o limite clínico descrito no documento.

NOME DAS AÇÕES (CRÍTICO PARA A VINCULAÇÃO COM O SISTEMA)
- "nome" de uma ação tipo "Exame" deve ser o NOME CLÍNICO OFICIAL do exame/procedimento, curto e
  pesquisável (ex.: "Hemograma completo", "Creatinina sérica", "Ultrassonografia abdominal",
  "Medida de pressão arterial em consultório"), nunca uma frase longa ou uma lista de vários exames
  em um único item — quebre em várias ações quando o documento pedir múltiplos exames.
- "nome" de uma ação tipo "Receita" deve ser o nome da SUBSTÂNCIA/princípio ativo em português,
  sem dose (ex.: "Enalapril", "Losartana potássica", "Espironolactona"), nunca o nome comercial nem
  a dose — a dose vai em "descricao". O sistema fará a vinculação com o catálogo de substâncias
  automaticamente a partir desse nome; por isso ele precisa ser o nome genérico exato.
- Nunca invente exames ou medicamentos que não estejam explícita ou claramente implícitos no
  documento/instruções.

Nunca copie parágrafos inteiros do documento para "descricao" — resuma com suas próprias palavras.
Nunca inclua texto fora do JSON.`;

function parseJsonLoose(text: string): Record<string, any> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

const TIPOS_ACAO = ["Consulta", "Exame", "Receita"] as const;
function normTipo(v: unknown): AcaoIA["tipo"] {
  const t = str(v);
  const hit = TIPOS_ACAO.find((x) => x.toLowerCase() === t.toLowerCase());
  return hit || "Exame";
}

export async function gerarProtocoloIA(opts: {
  apiKey: string;
  pdfBase64?: string | null;
  filename?: string | null;
  observacao?: string | null;
  /** Resolve o nome de um exame no catálogo oficial (tuss_procedimentos). */
  buscarTuss: (termo: string) => Promise<{ id: string; codigo_tuss: string; nome: string } | null>;
  /** Resolve o nome de uma substância no catálogo oficial (substancias). */
  buscarSubstancia: (termo: string) => Promise<{ id_substancia: string; nome_exibicao: string } | null>;
}): Promise<ProtocoloGerado> {
  const { apiKey, pdfBase64, filename, observacao, buscarTuss, buscarSubstancia } = opts;
  const obs = str(observacao);
  if (!obs && !pdfBase64) throw new Error("Envie um PDF ou uma observação.");

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: obs
        ? `Instruções do médico:\n${obs}`
        : "Estruture o protocolo assistencial descrito no documento anexo.",
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
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || "");

  const acoesBrutas = Array.isArray(parsed.acoes) ? parsed.acoes : [];
  const acoes: AcaoIA[] = acoesBrutas.map((x: any) => ({
    temp_id: str(x?.temp_id) || Math.random().toString(36).slice(2, 9),
    tipo: normTipo(x?.tipo),
    nome: str(x?.nome),
    especialidade: str(x?.especialidade),
    start_day: Number.isFinite(+x?.start_day) ? +x.start_day : 0,
    frequency: Number.isFinite(+x?.frequency) ? +x.frequency : 90,
    recurrent: x?.recurrent !== false,
    auto_restart: !!x?.auto_restart,
    descricao: str(x?.descricao),
    regra_pai_temp_id: x?.regra_pai_temp_id ? str(x.regra_pai_temp_id) : null,
    tuss_procedimento_id: null,
    codigo_tuss: null,
    id_substancia: null,
    catalogo_status: "nao_aplicavel",
  }));

  const pendencias: string[] = [];

  // Cruza cada ação com o catálogo real do sistema — é isto que substitui o
  // texto solto por um vínculo de fato (FK), com fallback explícito quando
  // não há correspondência (fica pendente de cadastro/revisão humana).
  for (const acao of acoes) {
    if (!acao.nome) continue;
    if (acao.tipo === "Exame") {
      try {
        const hit = await buscarTuss(acao.nome);
        if (hit) {
          acao.tuss_procedimento_id = hit.id;
          acao.codigo_tuss = hit.codigo_tuss;
          acao.nome = hit.nome || acao.nome;
          acao.catalogo_status = "vinculado";
        } else {
          acao.catalogo_status = "pendente_cadastro";
          pendencias.push(`Exame "${acao.nome}" não encontrado no catálogo TUSS — vincular manualmente.`);
        }
      } catch {
        acao.catalogo_status = "pendente_cadastro";
        pendencias.push(`Falha ao buscar "${acao.nome}" no catálogo TUSS — vincular manualmente.`);
      }
    } else if (acao.tipo === "Receita") {
      try {
        const hit = await buscarSubstancia(acao.nome);
        if (hit) {
          acao.id_substancia = hit.id_substancia;
          acao.nome = hit.nome_exibicao || acao.nome;
          acao.catalogo_status = "vinculado";
        } else {
          acao.catalogo_status = "pendente_cadastro";
          pendencias.push(`Medicamento "${acao.nome}" não encontrado no catálogo de substâncias — vincular manualmente.`);
        }
      } catch {
        acao.catalogo_status = "pendente_cadastro";
        pendencias.push(`Falha ao buscar "${acao.nome}" no catálogo de substâncias — vincular manualmente.`);
      }
    }
  }

  const idsAcoesValidos = new Set(acoes.map((a) => a.temp_id));
  const regrasBrutas = Array.isArray(parsed.regras) ? parsed.regras : [];
  const regras: RegraIA[] = regrasBrutas
    .map((r: any) => ({
      temp_id: str(r?.temp_id) || Math.random().toString(36).slice(2, 9),
      acao_gatilho_temp_id: str(r?.acao_gatilho_temp_id),
      descricao: str(r?.descricao),
      condicao: r?.is_default ? null : r?.condicao || null,
      ordem: Number.isFinite(+r?.ordem) ? +r.ordem : 0,
      is_default: !!r?.is_default,
      repete_gatilho_apos_dias:
        r?.repete_gatilho_apos_dias != null && Number.isFinite(+r.repete_gatilho_apos_dias)
          ? +r.repete_gatilho_apos_dias
          : null,
    }))
    // regra órfã (gatilho que a IA não devolveu junto) não pode ser salva
    .filter((r: RegraIA) => idsAcoesValidos.has(r.acao_gatilho_temp_id));

  return {
    titulo: str(parsed.titulo) || "Protocolo sem título",
    cids: Array.isArray(parsed.cids) ? parsed.cids.map((c: unknown) => str(c).toUpperCase()).filter(Boolean) : [],
    acoes,
    regras,
    pendencias,
  };
}
