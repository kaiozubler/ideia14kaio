-- Agendamento online: cada clínica gera um link público (/agendar/<token>)
-- em que o paciente marca a consulta sozinho. Decisões em
-- docs/architecture-rules.md.
--
--  agenda_online_config      link, chave liga/desliga e horário de funcionamento
--  agenda_medicos            médicos da clínica (a clínica é a conta do médico
--                            responsável, então os demais só existem aqui)
--  agenda_online_tentativas  limite de tentativas por IP (hash) no link público
--  agendamentos.agenda_medico_id  médico da consulta; nulo = consulta sem médico
--                            definido, que ocupa o horário de todos
--
-- Horários (jsonb): {"1":[{"ini":"08:00","fim":"12:00"}]}, chave 0 = domingo.

create table if not exists public.agenda_online_config (
  clinica_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  ativo boolean not null default false,
  horarios jsonb not null default '{
    "1":[{"ini":"08:00","fim":"12:00"},{"ini":"13:00","fim":"18:00"}],
    "2":[{"ini":"08:00","fim":"12:00"},{"ini":"13:00","fim":"18:00"}],
    "3":[{"ini":"08:00","fim":"12:00"},{"ini":"13:00","fim":"18:00"}],
    "4":[{"ini":"08:00","fim":"12:00"},{"ini":"13:00","fim":"18:00"}],
    "5":[{"ini":"08:00","fim":"12:00"},{"ini":"13:00","fim":"18:00"}]
  }'::jsonb check (jsonb_typeof(horarios) = 'object'),
  antecedencia_horas integer not null default 2 check (antecedencia_horas between 0 and 720),
  janela_dias integer not null default 60 check (janela_dias between 1 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agenda_medicos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references auth.users(id) on delete cascade,
  nome text not null check (length(btrim(nome)) > 0),
  especialidade text,
  rqe text,
  duracao_min integer not null default 30 check (duracao_min between 10 and 180),
  -- Nulo: atende em todo o horário de funcionamento da clínica.
  horarios jsonb check (horarios is null or jsonb_typeof(horarios) = 'object'),
  responsavel boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_medicos_clinica_idx on public.agenda_medicos (clinica_id);

create unique index if not exists agenda_medicos_responsavel_uidx on public.agenda_medicos (clinica_id) where responsavel;

create table if not exists public.agenda_online_tentativas (
  id bigint generated always as identity primary key,
  clinica_id uuid not null references auth.users(id) on delete cascade,
  ip_hash text not null,
  criado_em timestamptz not null default now()
);

create index if not exists agenda_online_tentativas_idx on public.agenda_online_tentativas (clinica_id, ip_hash, criado_em);

alter table public.agendamentos
  add column if not exists agenda_medico_id uuid references public.agenda_medicos(id) on delete set null;

create index if not exists idx_agendamentos_agenda_medico on public.agendamentos (agenda_medico_id, data_hora);

drop trigger if exists trg_agenda_online_config_updated on public.agenda_online_config;
create trigger trg_agenda_online_config_updated before update on public.agenda_online_config
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_agenda_medicos_updated on public.agenda_medicos;
create trigger trg_agenda_medicos_updated before update on public.agenda_medicos
  for each row execute function public.update_updated_at_column();

grant select, update on public.agenda_online_config to authenticated;
grant select, insert, update, delete on public.agenda_medicos to authenticated;
grant all on public.agenda_online_config, public.agenda_medicos, public.agenda_online_tentativas to service_role;

alter table public.agenda_online_config enable row level security;
alter table public.agenda_medicos enable row level security;
alter table public.agenda_online_tentativas enable row level security;

-- A equipe lê (a Agenda precisa da lista de médicos); só o médico responsável altera.
drop policy if exists "Clinica le a config da agenda online" on public.agenda_online_config;
create policy "Clinica le a config da agenda online" on public.agenda_online_config
  for select to authenticated using (clinica_id = (select public.clinica_id()));

drop policy if exists "Medico altera a config da agenda online" on public.agenda_online_config;
create policy "Medico altera a config da agenda online" on public.agenda_online_config
  for update to authenticated using (clinica_id = auth.uid()) with check (clinica_id = auth.uid());

drop policy if exists "Clinica le seus medicos" on public.agenda_medicos;
create policy "Clinica le seus medicos" on public.agenda_medicos
  for select to authenticated using (clinica_id = (select public.clinica_id()));

drop policy if exists "Medico gerencia os medicos da clinica" on public.agenda_medicos;
create policy "Medico gerencia os medicos da clinica" on public.agenda_medicos
  for all to authenticated using (clinica_id = auth.uid()) with check (clinica_id = auth.uid());

-- Médicos ativos contam contra a licença do plano (assinaturas.medicos), como
-- a equipe conta contra assinaturas.secretarias em clinica_convidar.
create or replace function public.agenda_medicos_limite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limite integer;
  ocupados integer;
begin
  if not new.ativo or (tg_op = 'UPDATE' and old.ativo) then
    return new;
  end if;
  select a.medicos into limite from public.assinaturas a
   where a.medico_id = new.clinica_id and a.status <> 'cancelada' limit 1;
  select count(*) into ocupados from public.agenda_medicos m
   where m.clinica_id = new.clinica_id and m.ativo and m.id <> new.id;
  if ocupados >= greatest(coalesce(limite, 1), 1) then
    raise exception 'Seu plano permite % médico(s) ativo(s).', greatest(coalesce(limite, 1), 1) using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.agenda_medicos_limite() from public;

drop trigger if exists trg_agenda_medicos_limite on public.agenda_medicos;
create trigger trg_agenda_medicos_limite before insert or update of ativo on public.agenda_medicos
  for each row execute function public.agenda_medicos_limite();

-- Garante a config e o médico responsável da clínica do usuário logado. A
-- equipe também chama: a Agenda precisa da lista de médicos para funcionar.
create or replace function public.agenda_online_preparar()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid := public.clinica_id();
  meta jsonb;
  dono_email text;
begin
  if auth.uid() is null or cid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  insert into public.agenda_online_config (clinica_id) values (cid) on conflict (clinica_id) do nothing;
  if exists (select 1 from public.agenda_medicos where clinica_id = cid and responsavel) then
    return;
  end if;
  select u.raw_user_meta_data, u.email into meta, dono_email from auth.users u where u.id = cid;
  insert into public.agenda_medicos (clinica_id, nome, especialidade, rqe, responsavel)
  values (
    cid,
    coalesce(nullif(btrim(meta->>'full_name'), ''), nullif(btrim(meta->>'name'), ''), dono_email),
    nullif(btrim(meta->>'especialidade'), ''),
    nullif(btrim(meta->>'rqe'), ''),
    true
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.agenda_online_preparar() from public, anon;
grant execute on function public.agenda_online_preparar() to authenticated;

-- Novo token invalida o link anterior na hora.
create or replace function public.agenda_online_novo_link()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  novo text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null or public.papel_clinica() <> 'medico' then
    raise exception 'Só o médico responsável pode gerar o link.' using errcode = '42501';
  end if;
  update public.agenda_online_config set token = novo where clinica_id = auth.uid();
  if not found then
    raise exception 'Agenda online não preparada.' using errcode = 'P0002';
  end if;
  return novo;
end;
$$;

revoke all on function public.agenda_online_novo_link() from public, anon;
grant execute on function public.agenda_online_novo_link() to authenticated;

-- Reserva pública, chamada só pelo servidor depois de conferir que o horário
-- pertence à grade. O lock por clínica serializa as reservas: duas pessoas
-- no mesmo horário não passam juntas pela checagem de conflito. Erros voltam
-- como {erro: ...} em vez de exception para a tentativa gravada não ser
-- desfeita junto com a transação.
create or replace function public.agenda_publica_reservar(
  p_token text,
  p_medico_id uuid,
  p_inicio timestamptz,
  p_nome text,
  p_cpf text,
  p_telefone text,
  p_email text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.agenda_online_config;
  med public.agenda_medicos;
  fim timestamptz;
  cpf_digitos text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  cpf_formatado text;
  pac uuid;
  novo_id uuid;
  rotulo_especialidade text;
begin
  select * into cfg from public.agenda_online_config where token = p_token and ativo;
  if cfg.clinica_id is null then
    return jsonb_build_object('erro', 'link_indisponivel');
  end if;
  select * into med from public.agenda_medicos where id = p_medico_id and clinica_id = cfg.clinica_id and ativo;
  if med.id is null then
    return jsonb_build_object('erro', 'horario_indisponivel');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agenda_online:' || cfg.clinica_id::text, 0));

  if p_ip_hash is not null then
    delete from public.agenda_online_tentativas
     where clinica_id = cfg.clinica_id and criado_em < now() - interval '1 day';
    insert into public.agenda_online_tentativas (clinica_id, ip_hash) values (cfg.clinica_id, p_ip_hash);
    if (select count(*) from public.agenda_online_tentativas
         where clinica_id = cfg.clinica_id and ip_hash = p_ip_hash and criado_em > now() - interval '1 hour') > 10 then
      return jsonb_build_object('erro', 'muitas_tentativas');
    end if;
  end if;

  fim := p_inicio + make_interval(mins => med.duracao_min);
  if exists (
    select 1 from public.agendamentos a
     where a.id_medico = cfg.clinica_id
       and coalesce(lower(a.status), 'agendado') not in ('cancelado', 'reagendado')
       and (a.agenda_medico_id = med.id or a.agenda_medico_id is null)
       and tstzrange(a.data_hora, a.data_hora + make_interval(mins => a.duracao_min)) && tstzrange(p_inicio, fim)
  ) then
    return jsonb_build_object('erro', 'horario_ocupado');
  end if;

  cpf_formatado := substr(cpf_digitos, 1, 3) || '.' || substr(cpf_digitos, 4, 3) || '.'
    || substr(cpf_digitos, 7, 3) || '-' || substr(cpf_digitos, 10, 2);

  if (select count(*) from public.agendamentos a
       where a.id_medico = cfg.clinica_id
         and a.origem = 'link_publico'
         and a.cpf = cpf_digitos
         and a.data_hora > now()
         and coalesce(lower(a.status), 'agendado') not in ('cancelado', 'reagendado')) >= 3 then
    return jsonb_build_object('erro', 'limite_cpf');
  end if;

  -- Paciente existente nunca é alterado por este link: quem digita um CPF não
  -- prova ser o dono dele. A resposta é a mesma para paciente novo ou antigo.
  select p.paciente_id into pac from public.pacientes p
   where p.user_id = cfg.clinica_id and p.cpf in (cpf_digitos, cpf_formatado) limit 1;
  if pac is null then
    insert into public.pacientes (user_id, name, cpf, telefone, email, medico, convenio)
    values (cfg.clinica_id, btrim(p_nome), cpf_formatado, p_telefone, nullif(btrim(coalesce(p_email, '')), ''), med.nome, 'Particular')
    returning paciente_id into pac;
  end if;

  rotulo_especialidade := case when nullif(btrim(med.rqe), '') is not null then nullif(btrim(med.especialidade), '') end;

  insert into public.agendamentos (
    id_medico, agenda_medico_id, paciente_id, paciente_nome, data_hora, duracao_min, status, motivo,
    origem, tipo, especialidade, medico_nome, telefone, cpf, modalidade
  ) values (
    cfg.clinica_id, med.id, pac, btrim(p_nome), p_inicio, med.duracao_min, 'agendado',
    'Consulta' || coalesce(' — ' || rotulo_especialidade, ''),
    'link_publico', 'Consulta', rotulo_especialidade, med.nome, p_telefone, cpf_digitos, 'presencial'
  )
  returning id into novo_id;

  return jsonb_build_object('id', novo_id);
end;
$$;

revoke all on function public.agenda_publica_reservar(text, uuid, timestamptz, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.agenda_publica_reservar(text, uuid, timestamptz, text, text, text, text, text) to service_role;
