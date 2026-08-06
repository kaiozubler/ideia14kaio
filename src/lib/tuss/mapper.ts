/** Mapeamento genérico de um conceito OCL da ANS para a linha de `tuss_procedimentos`. */
import type { OclConcept } from "./ocl-client.server";

/** Capítulos/grupos da TUSS conforme os 2 primeiros dígitos do código. */
const GRUPOS: Array<[RegExp, string]> = [
  [/^10/, "Consultas"],
  [/^20/, "Procedimentos clínicos ambulatoriais e hospitalares"],
  [/^21/, "Procedimentos diagnósticos e terapêuticos"],
  [/^22/, "Procedimentos diagnósticos e terapêuticos"],
  [/^3/, "Procedimentos cirúrgicos e invasivos"],
  [/^40/, "Patologia clínica / laboratório"],
  [/^41/, "Anatomia patológica e citopatologia"],
  [/^42/, "Diagnóstico por radiologia"],
  [/^43/, "Diagnóstico por ultrassonografia"],
  [/^44/, "Diagnóstico por tomografia computadorizada"],
  [/^45/, "Diagnóstico por ressonância magnética"],
  [/^46/, "Medicina nuclear e radiologia intervencionista"],
  [/^47/, "Radioterapia"],
  [/^48/, "Diagnóstico por endoscopia"],
  [/^49/, "Diagnóstico por métodos gráficos e outros"],
  [/^5/, "Terapias"],
  [/^6/, "Órteses, próteses e materiais especiais"],
  [/^7/, "Taxas, diárias e gases medicinais"],
  [/^8/, "Odontologia"],
  [/^9/, "Outros procedimentos"],
];

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v == null ? "" : String(v).trim();
  return s && s !== "-" ? s : null;
};

const date = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  if (iso) return iso;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
};

export function derivarGrupo(codigo: string): string | null {
  for (const [re, nome] of GRUPOS) if (re.test(codigo)) return nome;
  return null;
}

export type TussRow = {
  codigo_tuss: string;
  nome: string;
  descricao: string | null;
  classe: string | null;
  grupo: string | null;
  subgrupo: string | null;
  tabela: string;
  status: string | null;
  inicio_vigencia: string | null;
  fim_vigencia: string | null;
  fim_implantacao: string | null;
  dados_originais: OclConcept;
  ultima_sincronizacao: string;
};

export function mapearConceito(
  c: OclConcept,
  tabela: string,
  agora: string,
): TussRow | null {
  const codigo = str(c.id) ?? str((c as Record<string, unknown>)["code"]);
  const nome =
    str(c.display_name) ??
    str((c as Record<string, unknown>)["name"]) ??
    str((c as Record<string, unknown>)["descricao"]);
  if (!codigo || !nome) return null;

  const extras = (c.extras ?? {}) as Record<string, unknown>;
  const fim = date(extras["fim_vigencia"]);

  return {
    codigo_tuss: codigo,
    nome,
    descricao:
      str(extras["descricao"]) ??
      str((c as Record<string, unknown>)["definition"]) ??
      null,
    classe: str(extras["classe"]) ?? str((c as Record<string, unknown>)["concept_class"]),
    grupo: str(extras["grupo"]) ?? derivarGrupo(codigo),
    subgrupo: str(extras["subgrupo"]),
    tabela: str(c.source) ?? tabela,
    status: str(extras["status"]) ?? (fim ? "inativo" : "ativo"),
    inicio_vigencia: date(extras["inicio_vigencia"]),
    fim_vigencia: fim,
    fim_implantacao: date(extras["fim_implantacao"]),
    dados_originais: c,
    ultima_sincronizacao: agora,
  };
}
