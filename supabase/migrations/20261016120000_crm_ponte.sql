-- Ponte do Zubler CRM (/api/public/crm/*): o CRM é outro app e gerencia
-- clínicas, usuários, acessos e pagamentos deste projeto chamando essas
-- rotas do servidor dele, com o segredo CRM_BRIDGE_TOKEN.
--
--  crm_auditoria        toda escrita feita pela ponte (quem, o quê, em quem)
--  acessos_bloqueados   usuários suspensos; bloquear a clínica bloqueia o
--                       médico dono e todos os membros de clinica_membros
--  pagamentos_manuais   pix/boleto/transferência lançados à mão pelo CRM;
--                       nunca são apagados, o estorno só muda o status
--  asaas_cobrancas      cobranças recorrentes do Asaas recebidas pelo
--                       webhook, para o CRM ver o histórico junto dos manuais

-- ---------------------------------------------------------------------------
-- Auditoria (só service_role)
-- ---------------------------------------------------------------------------

create table if not exists public.crm_auditoria (
  id uuid primary key default gen_random_uuid(),
  acao text not null,
  alvo text,
  payload jsonb not null default '{}'::jsonb,
  ator text not null,
  criado_em timestamptz not null default now()
);

create index if not exists crm_auditoria_criado_em_idx on public.crm_auditoria (criado_em desc);
create index if not exists crm_auditoria_alvo_idx on public.crm_auditoria (alvo);

alter table public.crm_auditoria enable row level security;
-- Sem policy: anon e authenticated não leem nem escrevem.
revoke all on public.crm_auditoria from anon, authenticated;
grant all on public.crm_auditoria to service_role;

-- ---------------------------------------------------------------------------
-- Bloqueio de acesso
-- ---------------------------------------------------------------------------

create table if not exists public.acessos_bloqueados (
  user_id uuid primary key references auth.users(id) on delete cascade,
  motivo text,
  bloqueado_em timestamptz not null default now(),
  bloqueado_por text
);

alter table public.acessos_bloqueados enable row level security;
revoke all on public.acessos_bloqueados from anon, authenticated;
grant all on public.acessos_bloqueados to service_role;

-- O app chama sb.rpc('acesso_bloqueado', { uid }) a cada carregamento. Quem
-- está logado só consulta a si mesmo: perguntar por outro uid devolve false,
-- para não revelar quem está suspenso.
create or replace function public.acesso_bloqueado(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.role() = 'service_role' or uid = auth.uid()
      then exists (select 1 from public.acessos_bloqueados b where b.user_id = uid)
    else false
  end;
$$;

revoke all on function public.acesso_bloqueado(uuid) from public;
grant execute on function public.acesso_bloqueado(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pagamentos manuais
-- ---------------------------------------------------------------------------

create table if not exists public.pagamentos_manuais (
  id uuid primary key default gen_random_uuid(),
  medico_id uuid not null references auth.users(id) on delete restrict,
  assinatura_id uuid references public.assinaturas(id) on delete set null,
  valor numeric(10, 2) not null check (valor > 0),
  metodo text not null check (metodo in ('pix', 'boleto', 'cartao', 'transferencia', 'outro')),
  data date not null,
  referencia text,
  observacao text,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'estornado')),
  estorno_motivo text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pagamentos_manuais_medico_id_idx on public.pagamentos_manuais (medico_id);
create index if not exists pagamentos_manuais_data_idx on public.pagamentos_manuais (data desc);

drop trigger if exists set_updated_at on public.pagamentos_manuais;
create trigger set_updated_at
  before update on public.pagamentos_manuais
  for each row execute function public.update_updated_at_column();

-- Nunca apagar: o estorno é uma mudança de status, e o histórico financeiro
-- precisa continuar batendo com o que o CRM mostrou.
create or replace function public.pagamentos_manuais_sem_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'pagamentos_manuais não podem ser apagados; use status = estornado';
end;
$$;

drop trigger if exists pagamentos_manuais_sem_delete on public.pagamentos_manuais;
create trigger pagamentos_manuais_sem_delete
  before delete on public.pagamentos_manuais
  for each row execute function public.pagamentos_manuais_sem_delete();

alter table public.pagamentos_manuais enable row level security;
revoke all on public.pagamentos_manuais from anon, authenticated;
grant select, insert, update on public.pagamentos_manuais to service_role;

-- ---------------------------------------------------------------------------
-- Cobranças do Asaas (registradas pelo /api/asaas/webhook)
-- ---------------------------------------------------------------------------

create table if not exists public.asaas_cobrancas (
  asaas_payment_id text primary key,
  asaas_subscription_id text,
  medico_id uuid references auth.users(id) on delete set null,
  assinatura_id uuid references public.assinaturas(id) on delete set null,
  valor numeric(10, 2),
  status text,
  metodo text,
  vencimento date,
  pago_em date,
  ultimo_evento text,
  atualizado_em timestamptz not null default now()
);

create index if not exists asaas_cobrancas_medico_id_idx on public.asaas_cobrancas (medico_id);

alter table public.asaas_cobrancas enable row level security;
revoke all on public.asaas_cobrancas from anon, authenticated;
grant all on public.asaas_cobrancas to service_role;
