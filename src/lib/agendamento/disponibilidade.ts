// Cálculo dos horários oferecidos no link público de agendamento. Um horário
// só existe se couber no funcionamento da clínica, na grade do médico e não
// encostar em consulta já marcada. Sem dependência de banco para rodar em teste.

export type Faixa = { ini: string; fim: string };
export type GradeSemanal = Record<string, Faixa[]>;
export type Ocupado = { inicio: string; duracaoMin: number };
export type HorarioLivre = { inicio: string; hora: string };
export type DiaLivre = { data: string; horarios: HorarioLivre[] };

// A clínica opera no horário de Brasília, como os envios automáticos do
// WhatsApp: o servidor roda em UTC e o paciente pode estar em outro fuso.
const FUSO_BRASILIA = "-03:00";
const FUSO_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

function minutos(hhmm: unknown): number | null {
  if (typeof hhmm !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function faixasEmMinutos(faixas: unknown): [number, number][] {
  if (!Array.isArray(faixas)) return [];
  const validas: [number, number][] = [];
  for (const f of faixas as Partial<Faixa>[]) {
    const ini = minutos(f?.ini);
    const fim = minutos(f?.fim);
    if (ini !== null && fim !== null && ini < fim) validas.push([ini, fim]);
  }
  return validas.sort((a, b) => a[0] - b[0]);
}

function intersecao(a: [number, number][], b: [number, number][]) {
  const saida: [number, number][] = [];
  for (const [ai, af] of a) {
    for (const [bi, bf] of b) {
      const ini = Math.max(ai, bi);
      const fim = Math.min(af, bf);
      if (ini < fim) saida.push([ini, fim]);
    }
  }
  return saida;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const horaTexto = (min: number) => `${doisDigitos(Math.floor(min / 60))}:${doisDigitos(min % 60)}`;

/** Dia civil em Brasília de um instante. */
function dataBrasilia(ms: number) {
  return new Date(ms - FUSO_MS).toISOString().slice(0, 10);
}

export function calcularHorariosLivres(args: {
  clinica: GradeSemanal;
  /** Nulo: o médico atende em todo o horário da clínica. */
  medico: GradeSemanal | null;
  duracaoMin: number;
  ocupados: Ocupado[];
  agoraMs: number;
  antecedenciaHoras: number;
  janelaDias: number;
}): DiaLivre[] {
  const { clinica, medico, duracaoMin, agoraMs, antecedenciaHoras, janelaDias } = args;
  const ocupados = args.ocupados.map((o) => {
    const ini = new Date(o.inicio).getTime();
    return [ini, ini + o.duracaoMin * 60_000] as const;
  });
  const primeiroPermitido = agoraMs + antecedenciaHoras * 60 * 60 * 1000;
  const hoje = Date.parse(`${dataBrasilia(agoraMs)}T00:00:00Z`);
  const dias: DiaLivre[] = [];

  for (let i = 0; i <= janelaDias; i++) {
    const diaUtc = new Date(hoje + i * DIA_MS);
    const data = diaUtc.toISOString().slice(0, 10);
    const semana = String(diaUtc.getUTCDay());
    const daClinica = faixasEmMinutos(clinica?.[semana]);
    const faixas = medico ? intersecao(daClinica, faixasEmMinutos(medico[semana])) : daClinica;
    const horarios: HorarioLivre[] = [];

    for (const [ini, fim] of faixas) {
      for (let min = ini; min + duracaoMin <= fim; min += duracaoMin) {
        const hora = horaTexto(min);
        const inicioMs = Date.parse(`${data}T${hora}:00${FUSO_BRASILIA}`);
        const fimMs = inicioMs + duracaoMin * 60_000;
        if (inicioMs < primeiroPermitido) continue;
        if (ocupados.some(([oi, of]) => oi < fimMs && inicioMs < of)) continue;
        horarios.push({ inicio: new Date(inicioMs).toISOString(), hora });
      }
    }
    if (horarios.length) dias.push({ data, horarios });
  }
  return dias;
}

/** Status que liberam o horário; bate com a checagem de agenda_publica_reservar. */
export function statusLiberaHorario(status: string | null | undefined) {
  const s = String(status || "agendado").toLowerCase();
  return s === "cancelado" || s === "reagendado";
}

export function cpfValido(valor: string) {
  const cpf = valor.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== Number(cpf[tamanho])) return false;
  }
  return true;
}

// Nome e telefone do link público entram em telas que montam HTML (Agenda,
// Atendimentos), então só passam caracteres que não formam marcação.
export function nomeValido(valor: string) {
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{2,199}$/u.test(valor.trim());
}

export function telefoneValido(valor: string) {
  return /^[\d\s()+-]{10,30}$/.test(valor.trim()) && /^\d{10,13}$/.test(valor.replace(/\D/g, ""));
}

export const OBSERVACOES_MAX = 500;

/** Texto livre opcional do paciente: vazio vira null; não aceita marcação (ver nomeValido). */
export function observacoesValidas(valor: string | null | undefined) {
  const texto = String(valor ?? "").trim();
  return texto.length <= OBSERVACOES_MAX && !/[<>]/.test(texto);
}

export const FRASE_TROCA_LINK = "TROCAR LINK";

/** Frase digitada para gerar um novo link (sem diferenciar maiúsculas). */
export function confirmacaoTrocaValida(valor: string | null | undefined) {
  return (
    String(valor ?? "")
      .trim()
      .toUpperCase() === FRASE_TROCA_LINK
  );
}

/** Res. CFM 2.336/2023: especialidade só é anunciada junto do RQE. */
export function especialidadePublica(especialidade: string | null, rqe: string | null) {
  const esp = especialidade?.trim();
  const registro = rqe?.trim();
  return esp && registro ? `${esp} · RQE ${registro}` : null;
}
