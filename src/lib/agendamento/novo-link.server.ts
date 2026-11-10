// Troca do link público de agendamento. É a única forma de mudar o token:
// trocar por engano derruba o link já divulgado no site, no Instagram e no
// WhatsApp, então a rota exige a frase de confirmação e a senha da conta.
// Contas que só entram pelo Google não têm senha e confirmam digitando o
// e-mail da conta.
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { confirmacaoTrocaValida } from "./disponibilidade";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

type Usuario = {
  id: string;
  email?: string;
  identities?: { provider: string }[];
  app_metadata?: { providers?: string[]; provider?: string };
};

export type ResultadoTroca =
  | { ok: true; token: string }
  | { ok: false; status: number; erro: string };

export function contaTemSenha(u: Usuario) {
  if (u.identities?.some((i) => i.provider === "email")) return true;
  return !!u.app_metadata?.providers?.includes("email") || u.app_metadata?.provider === "email";
}

async function senhaConfere(email: string, senha: string) {
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: senha });
  if (error || !data.session) return false;
  // A conferência abre uma sessão nova; encerra só ela.
  await supabaseAdmin.auth.admin.signOut(data.session.access_token, "local").catch(() => {});
  return true;
}

function tokenNovo() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function trocarLink(
  authorization: string | null,
  body: { confirmacao: string; senha?: string; email?: string },
): Promise<ResultadoTroca> {
  if (!authorization?.startsWith("Bearer "))
    return { ok: false, status: 401, erro: "nao_autenticado" };
  const { data: auth } = await supabaseAdmin.auth.getUser(authorization.slice(7));
  const user = auth.user as Usuario | null;
  if (!user?.email) return { ok: false, status: 401, erro: "nao_autenticado" };

  const { data: membro, error: membroErr } = await db
    .from("clinica_membros")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "ativo")
    .maybeSingle();
  if (membroErr) throw membroErr;
  if (membro) return { ok: false, status: 403, erro: "somente_medico" };

  if (!confirmacaoTrocaValida(body.confirmacao))
    return { ok: false, status: 400, erro: "confirmacao_invalida" };

  if (contaTemSenha(user)) {
    if (!body.senha) return { ok: false, status: 400, erro: "senha_obrigatoria" };
    if (!(await senhaConfere(user.email, body.senha)))
      return { ok: false, status: 401, erro: "senha_incorreta" };
  } else if ((body.email || "").trim().toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, status: 401, erro: "email_incorreto" };
  }

  const token = tokenNovo();
  const { data, error } = await db
    .from("agenda_online_config")
    .update({ token })
    .eq("clinica_id", user.id)
    .select("token")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, erro: "agenda_nao_preparada" };
  return { ok: true, token: data.token };
}
