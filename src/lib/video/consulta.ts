// Link da teleconsulta mostrado ao paciente: uma página do próprio app
// (/consulta/<sala>) que embute a chamada do Daily, em vez do endereço
// <subdominio>.daily.co/<sala>. O Daily continua rodando por trás; o banco
// guarda a URL do Daily em `agendamentos.video_room_url` (o médico usa ela).

// Nomes gerados pelo app: "consulta-" + id (ver agmCreateVideoRoomForAgendamento
// e openVideoCall em medicopilot.html), no máximo 40 caracteres.
export const SALA_RE = /^consulta-[a-z0-9-]{1,31}$/;

export const SITE_PUBLICO = "https://medicopilot.lovable.app";

/** Nome da sala a partir da URL do Daily (ou do próprio nome). */
export function salaDoLink(urlOuNome: string | null | undefined): string | null {
  const v = (urlOuNome || "").trim();
  if (!v) return null;
  if (SALA_RE.test(v)) return v;
  try {
    const u = new URL(v);
    if (!/\.daily\.co$/i.test(u.hostname)) return null;
    const nome = u.pathname.replace(/^\/+|\/+$/g, "");
    return SALA_RE.test(nome) ? nome : null;
  } catch {
    return null;
  }
}

/** Link que vai para o paciente; cai na URL original se não reconhecer a sala. */
export function linkConsultaPaciente(origem: string, urlOuNome: string | null | undefined): string {
  const sala = salaDoLink(urlOuNome);
  if (!sala) return (urlOuNome || "").trim();
  return `${origem.replace(/\/+$/, "")}/consulta/${sala}`;
}

/** Origem pública no servidor (sem request à mão): PUBLIC_APP_URL ou o site publicado. */
export function origemPublicaServidor(): string {
  const env = (process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  return env || SITE_PUBLICO;
}
