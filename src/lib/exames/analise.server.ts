// IA dedicada à análise de arquivos de exames.
// Recebe o anexo (PDF ou imagem), extrai os dados de cadastro de CADA exame contido
// no arquivo, confere a identidade do paciente e gera relatório com pontos de atenção.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

export type AnexoExame = { nome?: string; mime?: string; base64?: string };

export type PacienteContexto = {
  nome?: string | null;
  cpf?: string | null;
  data_nascimento?: string | null;
} | null;

export type ExameExtraido = {
  nome: string;
  tipo: string;
  data: string;
  codigo_tuss: string | null;
  resultado: string;
  resumo: string;
  pontos_atencao: string[];
  valores: { analito: string; valor: string; referencia: string; situacao: string }[];
};

export type AnaliseExame = {
  paciente_detectado: { nome: string; cpf: string; data_nascimento: string };
  paciente_confere: boolean | null;
  divergencia_paciente: string;
  data_exame: string;
  laboratorio: string;
  exames: ExameExtraido[];
  resumo_geral: string;
  relatorio: string;
  pontos_atencao: string[];
  cadastro_sugerido: { nome: string; tipo: string; data: string; obs: string; resultado: string };
};

const SYSTEM_ANALISE = `Você é uma IA clínica especializada em LEITURA E ESTRUTURAÇÃO DE EXAMES médicos
(laboratoriais, de imagem e laudos), em português do Brasil.

Você recebe UM arquivo anexado, que pode conter VÁRIOS exames diferentes (ex.: um painel
laboratorial com hemograma, glicemia, creatinina, TSH). Trate cada exame como um item separado
na lista "exames".

SUAS TAREFAS
1. Identificar o paciente do documento (nome, CPF e data de nascimento, quando presentes) e
   comparar com o paciente do cadastro informado em "paciente_cadastro" (quando houver).
2. Extrair a data de realização/coleta de cada exame (formato AAAA-MM-DD). Se o arquivo tiver
   uma única data, repita-a em todos os exames.
3. Para cada exame, preencher os campos de cadastro: nome (nome oficial do exame, como
   "Hemograma completo", "Creatinina sérica", "Ultrassonografia abdominal"), tipo
   (exatamente um destes: Laboratorial, Imagem, Laudo, Documento, Outro), resultado
   (valores/achados principais em texto corrido curto) e os valores medidos com referência.
4. Para cada valor medido, informe "situacao" com um destes valores: "normal", "acima",
   "abaixo" ou "indeterminado", comparando com o intervalo de referência impresso no exame.
5. Gerar pontos de atenção clínicos. Todo valor fora da referência DEVE gerar um ponto de
   atenção objetivo (ex.: "Creatinina 1,9 mg/dL acima da referência (0,7–1,3) — avaliar função
   renal"). Achados de imagem/laudo relevantes também geram pontos de atenção.
6. Gerar um resumo por exame e um relatório geral consolidado do anexo.

REGRAS CRÍTICAS
- NUNCA invente valores, datas, nomes ou diagnósticos que não estejam no arquivo. Campo sem
  informação = string vazia "" (ou lista vazia).
- Não dê diagnóstico fechado nem prescreva conduta: aponte achados e pontos de atenção para o
  médico avaliar.
- "paciente_confere": true quando o nome/CPF do documento corresponde ao paciente do cadastro,
  false quando claramente é outra pessoa, null quando não há dados suficientes para comparar.
  Quando for false, explique em "divergencia_paciente".
- "cadastro_sugerido" é o preenchimento sugerido do formulário único de exame do sistema:
  quando houver vários exames, use um nome agregador (ex.: "Painel laboratorial — 4 exames")
  e consolide os resultados.

FORMATO DA RESPOSTA
Retorne EXCLUSIVAMENTE um JSON válido (sem markdown, sem cercas, sem comentários):
{
  "paciente_detectado": { "nome": "", "cpf": "", "data_nascimento": "" },
  "paciente_confere": null,
  "divergencia_paciente": "",
  "data_exame": "",
  "laboratorio": "",
  "exames": [
    {
      "nome": "",
      "tipo": "Laboratorial",
      "data": "",
      "resultado": "",
      "resumo": "",
      "pontos_atencao": [],
      "valores": [ { "analito": "", "valor": "", "referencia": "", "situacao": "normal" } ]
    }
  ],
  "resumo_geral": "",
  "relatorio": "",
  "pontos_atencao": [],
  "cadastro_sugerido": { "nome": "", "tipo": "Laboratorial", "data": "", "obs": "", "resultado": "" }
}`;

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

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

const TIPOS = ["Laboratorial", "Imagem", "Laudo", "Receita", "Atestado", "Documento", "Outro"];

function normTipo(v: unknown): string {
  const t = str(v);
  const hit = TIPOS.find((x) => x.toLowerCase() === t.toLowerCase());
  return hit || "Outro";
}

function contentBlocks(anexo: AnexoExame, texto: string, contexto: string) {
  const blocks: any[] = [{ type: "text", text: contexto }];
  const mime = str(anexo.mime) || "application/octet-stream";
  const b64 = str(anexo.base64).replace(/^data:[^;]+;base64,/, "");
  if (b64) {
    if (mime.startsWith("image/")) {
      blocks.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
    } else {
      blocks.push({
        type: "file",
        file: { filename: str(anexo.nome) || "exame", file_data: `data:${mime};base64,${b64}` },
      });
    }
  }
  if (texto) blocks.push({ type: "text", text: `Texto adicional fornecido pelo médico:\n${texto}` });
  return blocks;
}

export async function analisarExameArquivo(opts: {
  apiKey: string;
  anexo: AnexoExame;
  texto?: string;
  paciente?: PacienteContexto;
  buscarTuss?: (termo: string) => Promise<{ codigo_tuss: string; nome: string } | null>;
}): Promise<AnaliseExame> {
  const { apiKey, anexo, paciente } = opts;
  const b64 = str(anexo?.base64).replace(/^data:[^;]+;base64,/, "");
  if (!b64) throw new Error("Nenhum arquivo recebido para análise.");

  const contexto =
    "Analise o exame anexado e devolva o JSON no formato especificado.\n\n" +
    "paciente_cadastro: " +
    JSON.stringify(
      paciente
        ? {
            nome: paciente.nome || "",
            cpf: paciente.cpf || "",
            data_nascimento: paciente.data_nascimento || "",
          }
        : null,
    );

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_ANALISE },
        { role: "user", content: contentBlocks(anexo, str(opts.texto), contexto) },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || "");

  const pd = (parsed.paciente_detectado || {}) as Record<string, unknown>;
  const dataExame = str(parsed.data_exame);

  const exames: ExameExtraido[] = (Array.isArray(parsed.exames) ? parsed.exames : [])
    .map((e: any) => ({
      nome: str(e?.nome),
      tipo: normTipo(e?.tipo),
      data: str(e?.data) || dataExame,
      codigo_tuss: null as string | null,
      resultado: str(e?.resultado),
      resumo: str(e?.resumo),
      pontos_atencao: strList(e?.pontos_atencao),
      valores: (Array.isArray(e?.valores) ? e.valores : []).map((v: any) => ({
        analito: str(v?.analito),
        valor: str(v?.valor),
        referencia: str(v?.referencia),
        situacao: str(v?.situacao) || "indeterminado",
      })),
    }))
    .filter((e: ExameExtraido) => e.nome);

  // Cruza cada exame com a tabela oficial de procedimentos (TUSS) do sistema.
  if (opts.buscarTuss) {
    for (const ex of exames) {
      try {
        const hit = await opts.buscarTuss(ex.nome);
        if (hit) {
          ex.codigo_tuss = hit.codigo_tuss;
          if (hit.nome) ex.nome = hit.nome;
        }
      } catch {
        /* busca TUSS é enriquecimento — não bloqueia a análise */
      }
    }
  }

  const cs = (parsed.cadastro_sugerido || {}) as Record<string, unknown>;
  const pontosGerais = strList(parsed.pontos_atencao);
  const pontos = pontosGerais.length
    ? pontosGerais
    : exames.flatMap((e) => e.pontos_atencao.map((p) => `${e.nome}: ${p}`));

  const nomeSugerido =
    str(cs.nome) ||
    (exames.length > 1 ? `Painel de exames — ${exames.length} exames` : exames[0]?.nome || "Exame");

  return {
    paciente_detectado: {
      nome: str(pd.nome),
      cpf: str(pd.cpf),
      data_nascimento: str(pd.data_nascimento),
    },
    paciente_confere:
      typeof parsed.paciente_confere === "boolean" ? parsed.paciente_confere : null,
    divergencia_paciente: str(parsed.divergencia_paciente),
    data_exame: dataExame || exames[0]?.data || "",
    laboratorio: str(parsed.laboratorio),
    exames,
    resumo_geral: str(parsed.resumo_geral),
    relatorio: str(parsed.relatorio) || str(parsed.resumo_geral),
    pontos_atencao: pontos,
    cadastro_sugerido: {
      nome: nomeSugerido,
      tipo: normTipo(cs.tipo || exames[0]?.tipo),
      data: str(cs.data) || dataExame || exames[0]?.data || "",
      obs: str(cs.obs) || (pontos.length ? `Pontos de atenção: ${pontos.length}` : ""),
      resultado:
        str(cs.resultado) ||
        exames.map((e) => `${e.nome}: ${e.resultado || e.resumo}`).filter(Boolean).join("\n"),
    },
  };
}