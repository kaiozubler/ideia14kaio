-- Prontuário sem exclusão e com histórico de versões (Lei 13.787/2018,
-- CFM 1.638/2002 e 1.821/2007): o registro clínico pode ser corrigido, mas a
-- versão original e cada alteração continuam legíveis — na tela e na
-- impressão — e nada que já foi registrado pode ser apagado.
--
--  prontuario_versoes   uma linha por versão de cada registro clínico
--                       (consulta finalizada, exame, triagem, documento,
--                       cadastro do paciente); só recebe INSERT, pelo trigger
--  motivo_alteracao     coluna "de passagem": o app envia o motivo junto do
--                       UPDATE, o trigger o copia para a versão e limpa a
--                       coluna, para o próximo UPDATE não herdar o motivo
--
-- Rascunhos de consulta (acao = 'Rascunho') não geram versão — o autosave
-- reescreve o texto a cada tecla — e podem ser descartados enquanto nunca
-- tiverem sido finalizados. Todo o resto é bloqueado no DELETE, inclusive
-- para service_role, porque a guarda mínima é de 20 anos.

-- ---------------------------------------------------------------------------
-- Tabela de versões
-- ---------------------------------------------------------------------------

create table if not exists public.prontuario_versoes (
  id uuid primary key default gen_random_uuid(),
  tabela text not null,
  registro_id uuid not null,
  paciente_id uuid,
  id_medico uuid not null,
  versao integer not null check (versao > 0),
  operacao text not null check (operacao in ('original', 'criacao', 'edicao')),
  dados jsonb not null,
  motivo text,
  alterado_por uuid,
  alterado_por_nome text,
  alterado_em timestamptz not null default now(),
  unique (tabela, registro_id, versao)
);

create index if not exists prontuario_versoes_registro_idx on public.prontuario_versoes (tabela, registro_id, versao);
create index if not exists prontuario_versoes_paciente_idx on public.prontuario_versoes (paciente_id, alterado_em);

alter table public.prontuario_versoes enable row level security;
revoke all on public.prontuario_versoes from anon, authenticated;
grant select on public.prontuario_versoes to authenticated;
grant all on public.prontuario_versoes to service_role;

-- Só o médico dono do prontuário lê o histórico (a equipe não lê dados clínicos).
drop policy if exists "Medico le versoes do seu prontuario" on public.prontuario_versoes;
create policy "Medico le versoes do seu prontuario" on public.prontuario_versoes
  for select to authenticated using (id_medico = auth.uid());

create or replace function public.prontuario_versoes_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'O histórico do prontuário não pode ser alterado nem excluído.'
    using errcode = 'P0001', hint = 'prontuario_imutavel';
end;
$$;

drop trigger if exists trg_prontuario_versoes_imutavel on public.prontuario_versoes;
create trigger trg_prontuario_versoes_imutavel
  before update or delete on public.prontuario_versoes
  for each row execute function public.prontuario_versoes_imutavel();

-- ---------------------------------------------------------------------------
-- Versionamento
-- ---------------------------------------------------------------------------

alter table public.consulta add column if not exists motivo_alteracao text;
alter table public.exames add column if not exists motivo_alteracao text;
alter table public.triagens add column if not exists motivo_alteracao text;
alter table public.documentos_paciente add column if not exists motivo_alteracao text;
alter table public.pacientes add column if not exists motivo_alteracao text;

-- Nome de quem alterou, gravado na versão: o membro da equipe pelo nome do
-- convite, o médico pelo nome do cadastro (com CRM quando houver).
create or replace function public.prontuario_nome_autor(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.nome || coalesce(' (' || nullif(btrim(m.registro), '') || ')', '')
       from public.clinica_membros m where m.user_id = uid and m.status = 'ativo' limit 1),
    (select coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), u.email)
            || coalesce(' — CRM ' || nullif(btrim(u.raw_user_meta_data->>'crm'), ''), '')
       from auth.users u where u.id = uid),
    'Sistema'
  );
$$;

revoke all on function public.prontuario_nome_autor(uuid) from public, anon, authenticated;

-- TG_ARGV[0]: coluna do dono (id_medico/user_id); TG_ARGV[1]: chave primária.
-- Roda por último entre os BEFORE (ordem alfabética do nome "zz_…"), então a
-- versão guarda exatamente o que vai para a tabela, já com updated_at novo.
create or replace function public.prontuario_versionar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col_dono text := TG_ARGV[0];
  col_pk text := coalesce(TG_ARGV[1], 'id');
  novo jsonb;
  antigo jsonb;
  motivo text;
  registro uuid;
  prox integer;
  op text;
  autor uuid := auth.uid();
begin
  novo := to_jsonb(NEW);
  motivo := nullif(btrim(novo->>'motivo_alteracao'), '');
  if novo->>'motivo_alteracao' is not null then
    NEW := jsonb_populate_record(NEW, jsonb_build_object('motivo_alteracao', null));
    novo := to_jsonb(NEW);
  end if;

  -- OLD/NEW só via jsonb: a função serve a tabelas com colunas diferentes.
  if TG_OP = 'UPDATE' then
    antigo := to_jsonb(OLD);
  end if;

  -- Consulta finalizada não volta a ser rascunho (rascunho pode ser excluído).
  if TG_OP = 'UPDATE' and TG_TABLE_NAME = 'consulta'
     and coalesce(antigo->>'acao', '') <> 'Rascunho' and coalesce(novo->>'acao', '') = 'Rascunho' then
    NEW := jsonb_populate_record(NEW, jsonb_build_object('acao', antigo->'acao', 'ended_at', antigo->'ended_at'));
    novo := to_jsonb(NEW);
  end if;

  if TG_TABLE_NAME = 'consulta' and coalesce(novo->>'acao', '') = 'Rascunho' then
    return NEW;
  end if;

  registro := (novo->>col_pk)::uuid;

  if TG_OP = 'UPDATE' then
    if (antigo - 'updated_at' - 'motivo_alteracao') = (novo - 'updated_at' - 'motivo_alteracao') then
      return NEW;
    end if;
  end if;

  select coalesce(max(versao), 0) + 1 into prox
    from public.prontuario_versoes where tabela = TG_TABLE_NAME and registro_id = registro;

  if TG_OP = 'INSERT' or (TG_TABLE_NAME = 'consulta' and coalesce(antigo->>'acao', '') = 'Rascunho' and prox = 1) then
    op := 'criacao';
  else
    -- Registro anterior a este histórico: guarda o estado de antes como original.
    if prox = 1 then
      insert into public.prontuario_versoes
        (tabela, registro_id, paciente_id, id_medico, versao, operacao, dados, alterado_por, alterado_por_nome, alterado_em)
      values
        (TG_TABLE_NAME, registro, nullif(antigo->>'paciente_id', '')::uuid, (antigo->>col_dono)::uuid, 1, 'original',
         antigo - 'motivo_alteracao', null, 'Registro anterior ao histórico',
         coalesce((antigo->>'updated_at')::timestamptz, (antigo->>'created_at')::timestamptz, now()));
      prox := 2;
    end if;
    op := 'edicao';
  end if;

  insert into public.prontuario_versoes
    (tabela, registro_id, paciente_id, id_medico, versao, operacao, dados, motivo, alterado_por, alterado_por_nome)
  values
    (TG_TABLE_NAME, registro, nullif(novo->>'paciente_id', '')::uuid, (novo->>col_dono)::uuid, prox, op,
     novo - 'motivo_alteracao', motivo, autor,
     case when autor is null then 'Sistema' else public.prontuario_nome_autor(autor) end);

  return NEW;
end;
$$;

drop trigger if exists zz_prontuario_versao on public.consulta;
create trigger zz_prontuario_versao before insert or update on public.consulta
  for each row execute function public.prontuario_versionar('id_medico', 'id');

drop trigger if exists zz_prontuario_versao on public.exames;
create trigger zz_prontuario_versao before insert or update on public.exames
  for each row execute function public.prontuario_versionar('user_id', 'id');

drop trigger if exists zz_prontuario_versao on public.triagens;
create trigger zz_prontuario_versao before insert or update on public.triagens
  for each row execute function public.prontuario_versionar('id_medico', 'id');

drop trigger if exists zz_prontuario_versao on public.documentos_paciente;
create trigger zz_prontuario_versao before insert or update on public.documentos_paciente
  for each row execute function public.prontuario_versionar('id_medico', 'id');

drop trigger if exists zz_prontuario_versao on public.pacientes;
create trigger zz_prontuario_versao before insert or update on public.pacientes
  for each row execute function public.prontuario_versionar('user_id', 'paciente_id');

-- ---------------------------------------------------------------------------
-- Bloqueio de exclusão
-- ---------------------------------------------------------------------------

create or replace function public.prontuario_bloquear_exclusao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  antigo jsonb := to_jsonb(OLD);
  pac uuid := nullif(antigo->>'paciente_id', '')::uuid;
begin
  if TG_TABLE_NAME = 'consulta' and antigo->>'acao' = 'Rascunho' and not exists (
    select 1 from public.prontuario_versoes v where v.tabela = 'consulta' and v.registro_id = (antigo->>'id')::uuid
  ) then
    return OLD;
  end if;

  -- Paciente sem nenhum registro clínico (cadastro duplicado já mesclado,
  -- cadastro feito por engano) ainda pode sair; com registro, nunca.
  if TG_TABLE_NAME = 'pacientes' and not (
    exists (select 1 from public.consulta c where c.paciente_id = pac and c.acao is distinct from 'Rascunho')
    or exists (select 1 from public.exames e where e.paciente_id = pac)
    or exists (select 1 from public.triagens t where t.paciente_id = pac)
    or exists (select 1 from public.documentos_paciente d where d.paciente_id = pac)
    or exists (select 1 from public.medicamentos_em_uso m where m.paciente_id = pac)
    or exists (select 1 from public.lme_processos l where l.paciente_id = pac)
  ) then
    return OLD;
  end if;

  raise exception 'Registros do prontuário não podem ser excluídos (guarda mínima de 20 anos, Lei 13.787/2018). Use a edição: a versão original fica no histórico.'
    using errcode = 'P0001', hint = 'prontuario_sem_exclusao';
end;
$$;

drop trigger if exists trg_prontuario_sem_exclusao on public.consulta;
create trigger trg_prontuario_sem_exclusao before delete on public.consulta
  for each row execute function public.prontuario_bloquear_exclusao();

drop trigger if exists trg_prontuario_sem_exclusao on public.exames;
create trigger trg_prontuario_sem_exclusao before delete on public.exames
  for each row execute function public.prontuario_bloquear_exclusao();

drop trigger if exists trg_prontuario_sem_exclusao on public.triagens;
create trigger trg_prontuario_sem_exclusao before delete on public.triagens
  for each row execute function public.prontuario_bloquear_exclusao();

drop trigger if exists trg_prontuario_sem_exclusao on public.documentos_paciente;
create trigger trg_prontuario_sem_exclusao before delete on public.documentos_paciente
  for each row execute function public.prontuario_bloquear_exclusao();

drop trigger if exists trg_prontuario_sem_exclusao on public.medicamentos_em_uso;
create trigger trg_prontuario_sem_exclusao before delete on public.medicamentos_em_uso
  for each row execute function public.prontuario_bloquear_exclusao();

drop trigger if exists trg_prontuario_sem_exclusao on public.pacientes;
create trigger trg_prontuario_sem_exclusao before delete on public.pacientes
  for each row execute function public.prontuario_bloquear_exclusao();

-- Os PDFs e anexos do prontuário também não saem do storage. Política
-- restritiva: soma-se (AND) às permissivas já existentes nesses buckets.
drop policy if exists "Prontuario sem exclusao de arquivos" on storage.objects;
create policy "Prontuario sem exclusao de arquivos" on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id not in ('exames-arquivos', 'documentos-arquivos'));
