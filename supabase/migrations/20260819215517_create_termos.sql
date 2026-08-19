-- Módulo "Termos de Ciência" — mesma arquitetura de public.questionarios,
-- mas com um corpo de texto (com variáveis) + checkbox de aceite no lugar
-- de perguntas, e autenticação por email SEMPRE obrigatória (não é uma
-- opção configurável como em questionarios.exigir_auth_email).

create table if not exists public.termos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  titulo text not null,
  -- Corpo do termo, com placeholders substituídos na hora da exibição/assinatura:
  -- {paciente_nome} {paciente_cpf} {paciente_email} {medico_nome} {data_assinatura}
  corpo text not null,
  checkbox_label text not null default 'Li e estou de acordo com os termos acima.',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.termo_assinaturas (
  id uuid primary key default gen_random_uuid(),
  termo_id uuid not null references public.termos(id) on delete cascade,
  paciente_id uuid references public.pacientes(paciente_id),
  paciente_nome text not null,
  paciente_cpf text not null,
  paciente_email text not null,
  -- Snapshot do texto já com as variáveis substituídas no momento da
  -- assinatura — é o registro legal; nunca muda mesmo que o termo seja
  -- editado depois.
  texto_final text not null,
  checkbox_aceito boolean not null default false,
  email_verificado boolean not null default false,
  assinado_em timestamptz not null default now()
);

create table if not exists public.termo_email_codigos (
  id uuid primary key default gen_random_uuid(),
  termo_id uuid not null references public.termos(id) on delete cascade,
  email text not null,
  codigo text not null,
  tentativas integer not null default 0,
  verificado boolean not null default false,
  expira_em timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_termos_user on public.termos(user_id);
create index if not exists idx_termo_assinaturas_termo on public.termo_assinaturas(termo_id);
create index if not exists idx_termo_ec_lookup on public.termo_email_codigos(termo_id, email, created_at desc);

alter table public.termos enable row level security;
alter table public.termo_assinaturas enable row level security;
alter table public.termo_email_codigos enable row level security;

grant select, insert, update, delete on public.termos to authenticated;
grant all on public.termos to service_role;

grant select on public.termo_assinaturas to authenticated;
grant all on public.termo_assinaturas to service_role;

grant all on public.termo_email_codigos to service_role;

drop policy if exists "Medicos gerenciam seus termos" on public.termos;
create policy "Medicos gerenciam seus termos"
  on public.termos for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Medicos veem assinaturas dos seus termos" on public.termo_assinaturas;
create policy "Medicos veem assinaturas dos seus termos"
  on public.termo_assinaturas for select to authenticated
  using (exists (select 1 from public.termos t where t.id = termo_assinaturas.termo_id and t.user_id = auth.uid()));

-- termo_email_codigos e o INSERT em termo_assinaturas ficam só para
-- service_role: toda a gravação da assinatura pública passa pelo servidor
-- (src/routes/api/public/termos/*), nunca por escrita direta do anon.

-- RPC pública de leitura (link /t/{id}) — expõe só o necessário, sem dados
-- de outros médicos/termos, e resolve o nome do médico a partir do perfil
-- da conta dona do termo.
create or replace function public.termo_publico(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', t.id,
    'titulo', t.titulo,
    'corpo', t.corpo,
    'checkbox_label', t.checkbox_label,
    'ativo', t.ativo,
    'medico_nome', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email)
  )
  from public.termos t
  left join auth.users u on u.id = t.user_id
  where t.id = p_id and t.ativo = true
$$;

revoke all on function public.termo_publico(uuid) from public;
grant execute on function public.termo_publico(uuid) to anon, authenticated, service_role;
