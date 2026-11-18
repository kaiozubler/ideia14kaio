-- Uso do app para o Zubler CRM (insights, risco de churn e upgrade).
--
--  uso_eventos               cada abertura do app ('acesso') e cada troca de
--                            tela ('tela'), gravados pelo navegador
--                            (public/uso-registro.js). Quem grava é o
--                            próprio login; a clínica e a hora vêm do banco.
--  crm_uso_usuarios_dia()    acessos e telas por login e por dia
--  crm_uso_telas_dia()       eventos e logins distintos por tela e por dia
--  crm_uso_atividade_dia()   movimentação da clínica por dia: consultas,
--                            agendamentos criados, atendimentos agendados,
--                            pacientes novos e documentos
--
-- As funções só rodam com service_role (ponte /api/public/crm/uso). Os dias
-- são contados no horário de Brasília.

create table if not exists public.uso_eventos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clinica_id uuid,
  tipo text not null check (tipo in ('acesso', 'tela')),
  tela text check (tela is null or tela ~ '^[a-z0-9-]{1,40}$'),
  criado_em timestamptz not null default now()
);

create index if not exists uso_eventos_clinica_criado_idx on public.uso_eventos (clinica_id, criado_em desc);
create index if not exists uso_eventos_criado_idx on public.uso_eventos (criado_em desc);

-- O navegador não escolhe login, clínica nem horário.
create or replace function public.uso_eventos_preencher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    new.user_id := auth.uid();
    new.clinica_id := public.clinica_id();
    new.criado_em := now();
  end if;
  new.clinica_id := coalesce(new.clinica_id, new.user_id);
  return new;
end;
$$;

drop trigger if exists uso_eventos_preencher on public.uso_eventos;
create trigger uso_eventos_preencher
  before insert on public.uso_eventos
  for each row execute function public.uso_eventos_preencher();

alter table public.uso_eventos enable row level security;
revoke all on public.uso_eventos from anon, authenticated;
grant insert on public.uso_eventos to authenticated;
grant all on public.uso_eventos to service_role;

drop policy if exists "login_registra_o_proprio_uso" on public.uso_eventos;
create policy "login_registra_o_proprio_uso"
  on public.uso_eventos
  for insert
  to authenticated
  with check (user_id = auth.uid());
-- Sem policy de select: só o CRM (service_role) lê.

-- ---------------------------------------------------------------------------
-- Agregados por dia
-- ---------------------------------------------------------------------------

create or replace function public.crm_uso_usuarios_dia(p_desde date)
returns table (clinica_id uuid, user_id uuid, dia date, acessos int, telas int)
language sql
stable
set search_path = public
as $$
  select e.clinica_id,
         e.user_id,
         (e.criado_em at time zone 'America/Sao_Paulo')::date as dia,
         count(*) filter (where e.tipo = 'acesso')::int,
         count(*) filter (where e.tipo = 'tela')::int
    from public.uso_eventos e
   where e.criado_em >= (p_desde::timestamp at time zone 'America/Sao_Paulo')
   group by 1, 2, 3;
$$;

create or replace function public.crm_uso_telas_dia(p_desde date)
returns table (clinica_id uuid, tela text, dia date, eventos int, usuarios int)
language sql
stable
set search_path = public
as $$
  select e.clinica_id,
         e.tela,
         (e.criado_em at time zone 'America/Sao_Paulo')::date as dia,
         count(*)::int,
         count(distinct e.user_id)::int
    from public.uso_eventos e
   where e.tipo = 'tela'
     and e.criado_em >= (p_desde::timestamp at time zone 'America/Sao_Paulo')
   group by 1, 2, 3;
$$;

create or replace function public.crm_uso_atividade_dia(p_desde date)
returns table (
  clinica_id uuid,
  dia date,
  consultas int,
  agendamentos int,
  atendimentos_agendados int,
  pacientes int,
  documentos int
)
language sql
stable
set search_path = public
as $$
  with inicio as (select (p_desde::timestamp at time zone 'America/Sao_Paulo') as t),
  linhas as (
    select c.id_medico as clinica_id, (c.created_at at time zone 'America/Sao_Paulo')::date as dia,
           'consultas' as m
      from public.consulta c, inicio
     where c.created_at >= inicio.t and coalesce(c.acao, '') <> 'Rascunho'
    union all
    select a.id_medico, (a.created_at at time zone 'America/Sao_Paulo')::date, 'agendamentos'
      from public.agendamentos a, inicio
     where a.created_at >= inicio.t
    union all
    select a.id_medico, (a.data_hora at time zone 'America/Sao_Paulo')::date, 'atendimentos_agendados'
      from public.agendamentos a, inicio
     where a.data_hora >= inicio.t and a.data_hora < now()
       and coalesce(a.status, '') not in ('cancelado', 'cancelada')
    union all
    select p.user_id, (p.created_at at time zone 'America/Sao_Paulo')::date, 'pacientes'
      from public.pacientes p, inicio
     where p.created_at >= inicio.t
    union all
    select d.id_medico, (d.created_at at time zone 'America/Sao_Paulo')::date, 'documentos'
      from public.documentos_paciente d, inicio
     where d.created_at >= inicio.t
  )
  select clinica_id, dia,
         count(*) filter (where m = 'consultas')::int,
         count(*) filter (where m = 'agendamentos')::int,
         count(*) filter (where m = 'atendimentos_agendados')::int,
         count(*) filter (where m = 'pacientes')::int,
         count(*) filter (where m = 'documentos')::int
    from linhas
   where clinica_id is not null
   group by 1, 2;
$$;

revoke all on function public.crm_uso_usuarios_dia(date) from public, anon, authenticated;
revoke all on function public.crm_uso_telas_dia(date) from public, anon, authenticated;
revoke all on function public.crm_uso_atividade_dia(date) from public, anon, authenticated;
grant execute on function public.crm_uso_usuarios_dia(date) to service_role;
grant execute on function public.crm_uso_telas_dia(date) to service_role;
grant execute on function public.crm_uso_atividade_dia(date) to service_role;
