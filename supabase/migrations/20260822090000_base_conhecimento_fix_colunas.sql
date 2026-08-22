-- Reparo: o erro "Could not find the 'medico_id' column ... in the schema
-- cache" indica que ou a coluna nunca foi criada (a migration
-- 20260820120000 pode ter rodado parcialmente/numa tabela pré-existente), ou
-- o PostgREST está com o cache de schema desatualizado. Este script cobre
-- os dois casos: garante as colunas via ALTER (idempotente, seguro rodar de
-- novo) e força o PostgREST a recarregar o cache no final.

alter table public.base_conhecimento_itens
  add column if not exists medico_id uuid references auth.users(id) on delete cascade,
  add column if not exists base_id uuid references public.base_conhecimento(id) on delete cascade,
  add column if not exists tipo text,
  add column if not exists nome_original text,
  add column if not exists conteudo text,
  add column if not exists tokens_estimados int not null default 0,
  add column if not exists ordem int not null default 0,
  add column if not exists perguntas_relacionadas text,
  add column if not exists status text not null default 'pronto',
  add column if not exists created_at timestamptz not null default now();

create index if not exists base_conhecimento_itens_base_id_idx
  on public.base_conhecimento_itens (base_id);

drop index if exists base_conhecimento_itens_fts;
create index base_conhecimento_itens_fts
  on public.base_conhecimento_itens
  using gin (to_tsvector('portuguese', conteudo || ' ' || coalesce(perguntas_relacionadas, '')));

alter table public.base_conhecimento_itens enable row level security;
drop policy if exists "medico_gerencia_seus_itens" on public.base_conhecimento_itens;
create policy "medico_gerencia_seus_itens"
  on public.base_conhecimento_itens
  for all
  using (medico_id = auth.uid())
  with check (medico_id = auth.uid());

-- Força o PostgREST a recarregar o schema imediatamente, em vez de esperar
-- o próximo ciclo automático.
notify pgrst, 'reload schema';
