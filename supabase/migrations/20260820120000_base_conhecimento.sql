-- Base de conhecimento personalizada por médico, para alimentar o chat_ai e o
-- assistente_ai com arquivos/textos próprios, e atalhos de comando ("/algo")
-- que expandem para um prompt completo antes do envio.
--
-- Estratégia de custo de tokens:
--   - `base_conhecimento` guarda só nome/descrição/tags: é um índice pequeno,
--     sempre injetado no system prompt (poucos tokens), pra IA saber que
--     aquela base existe mesmo sem ler o conteúdo inteiro.
--   - `base_conhecimento_itens` guarda o conteúdo em pedaços (chunks) de
--     ~300-500 tokens, com um índice de full-text search em português
--     (mesmo padrão de public.tuss_procedimentos_fts). Só os chunks que
--     batem com a mensagem do usuário são buscados e injetados no prompt,
--     via a função `buscar_base_conhecimento` abaixo.

create table if not exists public.base_conhecimento (
  id uuid primary key default gen_random_uuid(),
  medico_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  descricao text not null default '',
  tags text[] not null default '{}',
  ias text[] not null default '{chat_ai,assistente_ai}',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists base_conhecimento_medico_id_idx
  on public.base_conhecimento (medico_id);

create table if not exists public.base_conhecimento_itens (
  id uuid primary key default gen_random_uuid(),
  base_id uuid not null references public.base_conhecimento(id) on delete cascade,
  medico_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('arquivo', 'texto')),
  nome_original text,
  conteudo text not null,
  tokens_estimados int not null default 0,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists base_conhecimento_itens_base_id_idx
  on public.base_conhecimento_itens (base_id);

create index if not exists base_conhecimento_itens_fts
  on public.base_conhecimento_itens
  using gin (to_tsvector('portuguese', conteudo));

create table if not exists public.prompt_comandos (
  id uuid primary key default gen_random_uuid(),
  medico_id uuid not null references auth.users(id) on delete cascade,
  atalho text not null,
  texto_completo text not null,
  ias text[] not null default '{chat_ai,assistente_ai}',
  created_at timestamptz not null default now(),
  unique (medico_id, atalho)
);

alter table public.base_conhecimento enable row level security;
alter table public.base_conhecimento_itens enable row level security;
alter table public.prompt_comandos enable row level security;

drop policy if exists "medico_gerencia_suas_bases" on public.base_conhecimento;
create policy "medico_gerencia_suas_bases"
  on public.base_conhecimento
  for all
  using (medico_id = auth.uid())
  with check (medico_id = auth.uid());

drop policy if exists "medico_gerencia_seus_itens" on public.base_conhecimento_itens;
create policy "medico_gerencia_seus_itens"
  on public.base_conhecimento_itens
  for all
  using (medico_id = auth.uid())
  with check (medico_id = auth.uid());

drop policy if exists "medico_gerencia_seus_atalhos" on public.prompt_comandos;
create policy "medico_gerencia_seus_atalhos"
  on public.prompt_comandos
  for all
  using (medico_id = auth.uid())
  with check (medico_id = auth.uid());

-- Busca textual (FTS) dos trechos de base de conhecimento relevantes para uma
-- mensagem, restrita às bases ativas do médico que valem para a IA informada.
-- security definer porque quem chama (service role do backend) já validou o
-- medico_id via token do usuário — não confie em p_medico_id vindo do cliente.
create or replace function public.buscar_base_conhecimento(
  p_medico_id uuid,
  p_mensagem text,
  p_ia text,
  p_limit int default 4
)
returns table (
  base_nome text,
  conteudo text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    bc.nome as base_nome,
    bci.conteudo,
    ts_rank(to_tsvector('portuguese', bci.conteudo), websearch_to_tsquery('portuguese', p_mensagem)) as rank
  from public.base_conhecimento_itens bci
  join public.base_conhecimento bc on bc.id = bci.base_id
  where bci.medico_id = p_medico_id
    and bc.ativo = true
    and p_ia = any(bc.ias)
    and to_tsvector('portuguese', bci.conteudo) @@ websearch_to_tsquery('portuguese', p_mensagem)
  order by rank desc
  limit p_limit;
$$;
