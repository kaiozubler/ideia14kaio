-- Base de conhecimento GLOBAL sobre o próprio sistema (o produto MediCopilot:
-- planos, funcionalidades, como usar cada tela, dúvidas de faturamento etc.),
-- para alimentar o assistente de suporte público (/api/suporte-ia).
--
-- Diferente de `base_conhecimento` (supabase/migrations/20260820120000_base_conhecimento.sql),
-- que é uma base PRIVADA por médico, esta aqui é uma base ÚNICA e pública —
-- não tem medico_id, e o conteúdo é o mesmo pra qualquer visitante/cliente
-- que conversar com o assistente de dúvidas do sistema.
--
-- Mesma estratégia de custo de tokens da base por médico: guarda o conteúdo
-- em pedaços (chunks) de ~300-500 tokens, com full-text search em português,
-- e só os chunks que batem com a mensagem do usuário são injetados no prompt
-- (via `buscar_base_conhecimento_sistema` abaixo).
--
-- Fica vazia por enquanto — a ideia é popular via SQL/dashboard quando a
-- base de conhecimento do produto for estruturada. Até lá, o assistente
-- responde só com o que já sabe pelo próprio system prompt.

create table if not exists public.base_conhecimento_sistema_itens (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  conteudo text not null,
  tags text[] not null default '{}',
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists base_conhecimento_sistema_itens_fts
  on public.base_conhecimento_sistema_itens
  using gin (to_tsvector('portuguese', conteudo));

create index if not exists base_conhecimento_sistema_itens_ativo_idx
  on public.base_conhecimento_sistema_itens (ativo);

alter table public.base_conhecimento_sistema_itens enable row level security;

-- Leitura pública (é conteúdo de ajuda do produto, não há dado sensível
-- aqui) — mas só do que estiver marcado como ativo. Escrita fica restrita
-- ao service role (sem policy de insert/update/delete = negado por padrão
-- pra anon/authenticated), então a manutenção do conteúdo é feita via
-- SQL/dashboard, não pelo cliente.
drop policy if exists "leitura_publica_base_sistema" on public.base_conhecimento_sistema_itens;
create policy "leitura_publica_base_sistema"
  on public.base_conhecimento_sistema_itens
  for select
  to anon, authenticated
  using (ativo = true);

-- Busca textual (FTS) dos trechos relevantes pra uma mensagem do visitante.
-- security definer só por consistência com buscar_base_conhecimento — como a
-- tabela já tem leitura pública liberada acima, não há elevação de
-- privilégio real aqui.
create or replace function public.buscar_base_conhecimento_sistema(
  p_mensagem text,
  p_limit int default 4
)
returns table (
  titulo text,
  conteudo text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    bcsi.titulo,
    bcsi.conteudo,
    ts_rank(to_tsvector('portuguese', bcsi.conteudo), websearch_to_tsquery('portuguese', p_mensagem)) as rank
  from public.base_conhecimento_sistema_itens bcsi
  where bcsi.ativo = true
    and to_tsvector('portuguese', bcsi.conteudo) @@ websearch_to_tsquery('portuguese', p_mensagem)
  order by rank desc
  limit p_limit;
$$;
