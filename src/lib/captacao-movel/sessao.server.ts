// Captação de áudio pelo smartphone (chamada aberta pelo computador).
//
// Fluxo:
//  1. O computador logado cria a sessão (POST /api/captacao-movel/sessao) e
//     mostra o QR com /captar#<token>. O token vai no fragmento (#) para nunca
//     chegar a logs nem a Referer; só o SHA-256 dele fica no banco.
//  2. O celular conecta (POST /api/public/captacao-movel/conectar) e começa a
//     captar sozinho. Ele transcreve direto no Deepgram com um token efêmero
//     emitido aqui e envia texto + nível do áudio em /evento.
//  3. O computador recebe tudo pelo Realtime (RLS: só o dono lê) e pode pausar,
//     retomar ou encerrar. O celular só pode encerrar — reabrir é sempre pelo
//     computador, com um QR novo.
import { sha256Hex } from "@/lib/documentos/verificacao.server";

export const ESPERA_LEITURA_MS = 5 * 60_000;
export const DURACAO_MAXIMA_MS = 4 * 60 * 60_000;

export type StatusCaptacao = "aguardando" | "conectado" | "pausado" | "encerrado";

export type SessaoCaptacao = {
  id: string;
  user_id: string;
  status: StatusCaptacao;
  encerrado_por: string | null;
  expira_em: string;
};

export function admin() {
  return import("@/integrations/supabase/client.server").then(
    // Tabelas novas, ainda fora dos tipos gerados.
    (m) => m.supabaseAdmin as unknown as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  );
}

/** 32 bytes aleatórios em hex: o QR carrega o token, o banco só o hash. */
export function gerarTokenCaptacao(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const TOKEN_REGEX = /^[0-9a-f]{64}$/;

/**
 * Sessão do token do QR, já marcada como expirada se passou do prazo. Devolve
 * null quando o token não existe ou o dono teve o acesso suspenso pelo CRM.
 */
export async function sessaoDoToken(token: string): Promise<SessaoCaptacao | null> {
  const db = await admin();
  const { data, error } = await db
    .from("captacao_movel_sessoes")
    .select("id,user_id,status,encerrado_por,expira_em")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const sessao = data as SessaoCaptacao;

  const { data: bloqueio, error: bloqueioErr } = await db
    .from("acessos_bloqueados")
    .select("user_id")
    .eq("user_id", sessao.user_id)
    .maybeSingle();
  if (bloqueioErr) throw bloqueioErr;
  if (bloqueio) {
    if (sessao.status !== "encerrado") await encerrar(sessao.id, "expirado");
    return null;
  }

  if (sessao.status !== "encerrado" && Date.parse(sessao.expira_em) <= Date.now()) {
    await encerrar(sessao.id, "expirado");
    return { ...sessao, status: "encerrado", encerrado_por: "expirado" };
  }
  return sessao;
}

export async function encerrar(id: string, por: "computador" | "smartphone" | "expirado") {
  const db = await admin();
  const { error } = await db
    .from("captacao_movel_sessoes")
    .update({ status: "encerrado", encerrado_por: por, nivel: 0, parcial: "" })
    .eq("id", id)
    .neq("status", "encerrado");
  if (error) throw error;
}

/** Remove chamadas antigas (e os trechos, em cascata): o texto já está no atendimento. */
export async function limparAntigas(userId: string) {
  const db = await admin();
  const limite = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { error } = await db
    .from("captacao_movel_sessoes")
    .delete()
    .eq("user_id", userId)
    .lt("criado_em", limite);
  if (error) console.warn("[captacao-movel] limpeza falhou:", error.message ?? error);
}

export const SEM_CACHE = { "Cache-Control": "no-store" };
