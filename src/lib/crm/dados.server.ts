// Leitura e escrita da ponte do CRM no Supabase (service role). A clínica é
// a conta do médico (id_medico); secretárias e enfermagem são as linhas de
// clinica_membros com user_id.

import type { User } from "@supabase/supabase-js";
import { esquecerBloqueios } from "@/lib/auth/bloqueio.server";
import { ErroCrm, nomeDaClinica, type RepoAcessos, type RepoPagamentos } from "@/lib/crm/ponte";
import type { Db } from "@/lib/crm/rota.server";

export type Usuario = {
  id: string;
  email: string | null;
  nome: string | null;
  clinica_id: string;
  clinica_nome: string | null;
  papel: string;
  acesso_bloqueado: boolean;
  bloqueio_motivo: string | null;
  ultimo_login: string | null;
};

export type Pagamento = {
  id: string;
  clinica_id: string | null;
  clinica_nome: string | null;
  valor: number | null;
  status: string | null;
  metodo: string | null;
  referencia: string | null;
  data: string | null;
  origem: "manual" | "asaas";
  observacao: string | null;
};

type Membro = {
  clinica_id: string;
  user_id: string | null;
  nome: string;
  email: string;
  papel: string;
  status: string;
};
type Config = {
  id_medico: string;
  fantasia: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
};
type Bloqueio = { user_id: string; motivo: string | null };
export type AssinaturaRow = {
  id: string;
  medico_id: string;
  contratacao_id: string | null;
  plano: string;
  ciclo: string;
  status: string;
  preco_mensal: number;
  proxima_cobranca: string | null;
  medicos: number;
  secretarias: number;
  cancelamento_agendado_para: string | null;
  ultimo_erro_cobranca: { em?: string } | null;
  updated_at: string;
  created_at: string;
};

function falha(tabela: string, error: { message: string } | null) {
  if (error) throw new Error(`${tabela}: ${error.message}`);
}

export function nomeDoUsuario(u: User | undefined): string | null {
  const m = (u?.user_metadata ?? {}) as Record<string, unknown>;
  const nome = m.name_user ?? m.full_name ?? m.name;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

/** Todos os logins do auth (paginado). */
export async function listarUsuariosAuth(db: Db): Promise<User[]> {
  const todos: User[] = [];
  const porPagina = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: porPagina });
    if (error) throw new Error(`auth.listUsers: ${error.message}`);
    const lote = (data?.users ?? []) as User[];
    todos.push(...lote);
    if (lote.length < porPagina) return todos;
  }
}

export async function usuarioAuth(db: Db, id: string): Promise<User | null> {
  const { data, error } = await db.auth.admin.getUserById(id);
  if (error || !data?.user) return null;
  return data.user as User;
}

/** Fotografia das tabelas que montam Usuario/clínica; uma consulta por tabela. */
export type Base = {
  usuarios: Map<string, User>;
  membros: Membro[];
  membroPorUser: Map<string, Membro>;
  configs: Map<string, Config>;
  bloqueios: Map<string, Bloqueio>;
  assinaturas: AssinaturaRow[];
};

export async function carregarBase(db: Db): Promise<Base> {
  const [usuarios, membros, configs, bloqueios, assinaturas] = await Promise.all([
    listarUsuariosAuth(db),
    db.from("clinica_membros").select("clinica_id, user_id, nome, email, papel, status"),
    db
      .from("medico_clinica_config")
      .select("id_medico, fantasia, razao_social, cnpj_cpf, email, telefone, cidade, uf"),
    db.from("acessos_bloqueados").select("user_id, motivo"),
    db
      .from("assinaturas")
      .select(
        "id, medico_id, contratacao_id, plano, ciclo, status, preco_mensal, proxima_cobranca, medicos, secretarias, cancelamento_agendado_para, ultimo_erro_cobranca, updated_at, created_at",
      )
      .order("created_at", { ascending: false }),
  ]);
  falha("clinica_membros", membros.error);
  falha("medico_clinica_config", configs.error);
  falha("acessos_bloqueados", bloqueios.error);
  falha("assinaturas", assinaturas.error);
  const listaMembros = (membros.data ?? []) as Membro[];
  return {
    usuarios: new Map(usuarios.map((u) => [u.id, u])),
    membros: listaMembros,
    membroPorUser: new Map(
      listaMembros.filter((m) => m.user_id).map((m) => [m.user_id as string, m]),
    ),
    configs: new Map(((configs.data ?? []) as Config[]).map((c) => [c.id_medico, c])),
    bloqueios: new Map(((bloqueios.data ?? []) as Bloqueio[]).map((b) => [b.user_id, b])),
    assinaturas: (assinaturas.data ?? []) as AssinaturaRow[],
  };
}

/** Assinatura vigente (não-cancelada) da clínica; sem ela, a mais recente. */
export function assinaturaDe(base: Base, clinicaId: string): AssinaturaRow | null {
  const daClinica = base.assinaturas.filter((a) => a.medico_id === clinicaId);
  return daClinica.find((a) => a.status !== "cancelada") ?? daClinica[0] ?? null;
}

export function nomeClinicaDe(base: Base, clinicaId: string): string | null {
  const dono = base.usuarios.get(clinicaId);
  return nomeDaClinica(base.configs.get(clinicaId), nomeDoUsuario(dono) ?? dono?.email ?? null);
}

/** Logins que são donos de clínica: todo usuário que não é membro de equipe. */
export function idsDeClinicas(base: Base): string[] {
  return [...base.usuarios.keys()].filter((id) => !base.membroPorUser.has(id));
}

export function membrosComLogin(base: Base, clinicaId: string): string[] {
  return base.membros
    .filter((m) => m.clinica_id === clinicaId && m.user_id)
    .map((m) => m.user_id as string);
}

export function montarUsuario(base: Base, u: User): Usuario {
  const membro = base.membroPorUser.get(u.id);
  const clinicaId = membro?.clinica_id ?? u.id;
  const bloqueio = base.bloqueios.get(u.id);
  return {
    id: u.id,
    email: u.email ?? null,
    nome: nomeDoUsuario(u) ?? membro?.nome ?? null,
    clinica_id: clinicaId,
    clinica_nome: nomeClinicaDe(base, clinicaId),
    papel: membro?.papel ?? "medico",
    acesso_bloqueado: !!bloqueio,
    bloqueio_motivo: bloqueio?.motivo ?? null,
    ultimo_login: u.last_sign_in_at ?? null,
  };
}

export function casaBusca(busca: string, ...campos: (string | null | undefined)[]): boolean {
  if (!busca) return true;
  const alvo = busca.toLocaleLowerCase("pt-BR");
  return campos.some((c) => c?.toLocaleLowerCase("pt-BR").includes(alvo));
}

// ---------------------------------------------------------------------------
// Bloqueio
// ---------------------------------------------------------------------------

// Além da linha em acessos_bloqueados (que o app e as /api conferem), o
// login é banido no Auth: sem isso, a sessão já aberta continuaria
// renovando o token e lendo o banco direto pelo PostgREST.
const BAN_INDEFINIDO = "876000h";

async function banir(db: Db, ids: string[], duracao: string) {
  await Promise.all(
    ids.map(async (id) => {
      const { error } = await db.auth.admin.updateUserById(id, { ban_duration: duracao });
      if (error)
        console.error(
          `[crm] não foi possível ${duracao === "none" ? "desbanir" : "banir"} ${id}:`,
          error.message,
        );
    }),
  );
}

export function repoAcessos(db: Db): RepoAcessos {
  return {
    async membrosDaClinica(clinicaId) {
      const { data, error } = await db
        .from("clinica_membros")
        .select("user_id")
        .eq("clinica_id", clinicaId)
        .not("user_id", "is", null);
      falha("clinica_membros", error);
      return ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
    },
    async bloquear(ids, motivo, por) {
      const agora = new Date().toISOString();
      const { error } = await db
        .from("acessos_bloqueados")
        .upsert(
          ids.map((user_id) => ({ user_id, motivo, bloqueado_por: por, bloqueado_em: agora })),
        );
      falha("acessos_bloqueados", error);
      esquecerBloqueios(ids);
      await banir(db, ids, BAN_INDEFINIDO);
    },
    async liberar(ids) {
      const { error } = await db.from("acessos_bloqueados").delete().in("user_id", ids);
      falha("acessos_bloqueados", error);
      esquecerBloqueios(ids);
      await banir(db, ids, "none");
    },
  };
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------

export async function reativarSeInadimplente(db: Db, medicoId: string) {
  const { error } = await db
    .from("assinaturas")
    .update({ status: "ativa", ultimo_erro_cobranca: null })
    .eq("medico_id", medicoId)
    .eq("status", "inadimplente");
  falha("assinaturas", error);
}

export function repoPagamentos(db: Db): RepoPagamentos {
  return {
    async buscar(id) {
      const { data, error } = await db
        .from("pagamentos_manuais")
        .select("id, medico_id, status")
        .eq("id", id)
        .maybeSingle();
      falha("pagamentos_manuais", error);
      return data ?? null;
    },
    async atualizarStatus(id, status, estornoMotivo) {
      const { error } = await db
        .from("pagamentos_manuais")
        .update({ status, estorno_motivo: estornoMotivo })
        .eq("id", id);
      falha("pagamentos_manuais", error);
    },
    reativarSeInadimplente: (medicoId) => reativarSeInadimplente(db, medicoId),
  };
}

type ManualRow = {
  id: string;
  medico_id: string;
  valor: number;
  status: string;
  metodo: string;
  referencia: string | null;
  data: string;
  observacao: string | null;
  estorno_motivo: string | null;
};
type AsaasRow = {
  asaas_payment_id: string;
  medico_id: string | null;
  valor: number | null;
  status: string | null;
  metodo: string | null;
  vencimento: string | null;
  pago_em: string | null;
};

/** Manuais + cobranças do Asaas registradas, mais recentes primeiro. */
export async function listarPagamentos(
  db: Db,
  base: Base,
  opcoes: { clinicaId?: string; limite: number },
): Promise<Pagamento[]> {
  let manuais = db
    .from("pagamentos_manuais")
    .select("id, medico_id, valor, status, metodo, referencia, data, observacao, estorno_motivo")
    .order("data", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opcoes.limite);
  let asaas = db
    .from("asaas_cobrancas")
    .select("asaas_payment_id, medico_id, valor, status, metodo, vencimento, pago_em")
    .order("atualizado_em", { ascending: false })
    .limit(opcoes.limite);
  if (opcoes.clinicaId) {
    manuais = manuais.eq("medico_id", opcoes.clinicaId);
    asaas = asaas.eq("medico_id", opcoes.clinicaId);
  }
  const [m, a] = await Promise.all([manuais, asaas]);
  falha("pagamentos_manuais", m.error);
  falha("asaas_cobrancas", a.error);

  const lista: Pagamento[] = [
    ...((m.data ?? []) as ManualRow[]).map((p) => ({
      id: p.id,
      clinica_id: p.medico_id,
      clinica_nome: nomeClinicaDe(base, p.medico_id),
      valor: Number(p.valor),
      status: p.status,
      metodo: p.metodo,
      referencia: p.referencia,
      data: p.data,
      origem: "manual" as const,
      observacao:
        p.status === "estornado" && p.estorno_motivo
          ? [p.observacao, `Estorno: ${p.estorno_motivo}`].filter(Boolean).join(" — ")
          : p.observacao,
    })),
    ...((a.data ?? []) as AsaasRow[]).map((p) => ({
      id: p.asaas_payment_id,
      clinica_id: p.medico_id,
      clinica_nome: p.medico_id ? nomeClinicaDe(base, p.medico_id) : null,
      valor: p.valor == null ? null : Number(p.valor),
      status: p.status,
      metodo: p.metodo,
      referencia: p.asaas_payment_id,
      data: p.pago_em ?? p.vencimento,
      origem: "asaas" as const,
      observacao: null,
    })),
  ];
  lista.sort((x, y) => String(y.data ?? "").localeCompare(String(x.data ?? "")));
  return lista.slice(0, opcoes.limite);
}

export async function exigirClinica(db: Db, id: string): Promise<User> {
  const u = await usuarioAuth(db, id);
  if (!u) throw new ErroCrm(404, "clínica não encontrada");
  const { data } = await db
    .from("clinica_membros")
    .select("id")
    .eq("user_id", id)
    .limit(1)
    .maybeSingle();
  if (data) throw new ErroCrm(404, "este usuário é membro de equipe, não dono de clínica");
  return u;
}
