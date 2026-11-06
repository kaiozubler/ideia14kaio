-- Captação de áudio pelo smartphone: durante a consulta o computador abre uma
-- "chamada" (QR code) e o celular vira o microfone. O celular transcreve no
-- Deepgram com os mesmos parâmetros da gravação local e envia o texto e o
-- nível do áudio ao servidor, que grava aqui; o computador recebe pelo
-- Supabase Realtime. Decisões em docs/architecture-rules.md.
--
--  captacao_movel_sessoes  uma chamada: dono (login do computador), hash do
--                          token do QR, estado, nível/qualidade e texto parcial
--  captacao_movel_trechos  falas finais transcritas no celular, em ordem
--
-- Só o servidor escreve (service_role); o computador apenas lê o que é seu.

create table if not exists public.captacao_movel_sessoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'aguardando'
    check (status in ('aguardando', 'conectado', 'pausado', 'encerrado')),
  encerrado_por text check (encerrado_por in ('computador', 'smartphone', 'expirado')),
  nivel smallint not null default 0 check (nivel between 0 and 100),
  confianca smallint check (confianca between 0 and 100),
  parcial text not null default '' check (length(parcial) <= 2000),
  dispositivo text check (length(dispositivo) <= 200),
  criado_em timestamptz not null default now(),
  conectado_em timestamptz,
  visto_em timestamptz,
  -- Antes da leitura: 5 min para escanear. Depois de conectado: duração máxima da chamada.
  expira_em timestamptz not null default now() + interval '5 minutes'
);

create index if not exists captacao_movel_sessoes_user_idx on public.captacao_movel_sessoes (user_id, criado_em desc);

create table if not exists public.captacao_movel_trechos (
  id bigint generated always as identity primary key,
  sessao_id uuid not null references public.captacao_movel_sessoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  texto text not null check (length(btrim(texto)) > 0 and length(texto) <= 4000),
  criado_em timestamptz not null default now()
);

create index if not exists captacao_movel_trechos_sessao_idx on public.captacao_movel_trechos (sessao_id, id);

grant select on public.captacao_movel_sessoes, public.captacao_movel_trechos to authenticated;
grant all on public.captacao_movel_sessoes, public.captacao_movel_trechos to service_role;

alter table public.captacao_movel_sessoes enable row level security;
alter table public.captacao_movel_trechos enable row level security;

-- Por login, não por clínica: a transcrição é do atendimento aberto naquele computador.
drop policy if exists "Dono le suas captacoes" on public.captacao_movel_sessoes;
create policy "Dono le suas captacoes" on public.captacao_movel_sessoes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Dono le seus trechos" on public.captacao_movel_trechos;
create policy "Dono le seus trechos" on public.captacao_movel_trechos
  for select to authenticated using (user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'captacao_movel_sessoes') then
      alter publication supabase_realtime add table public.captacao_movel_sessoes;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'captacao_movel_trechos') then
      alter publication supabase_realtime add table public.captacao_movel_trechos;
    end if;
  end if;
end $$;
