-- Aditiva à migration anterior (20260820120000_base_conhecimento.sql), que já
-- foi aplicada — por isso uma migration nova em vez de editar a antiga.
--
-- Objetivo: quando um chunk é enviado, a IA gera (uma única vez, no upload —
-- não a cada mensagem de chat) de 2 a 4 perguntas que aquele trecho responde.
-- Isso funciona como ponte de vocabulário: o médico pode perguntar com
-- palavras diferentes das do documento, e ainda assim a busca textual (FTS)
-- encontra o chunk certo, porque ela também casa com as perguntas geradas.

alter table public.base_conhecimento_itens
  add column if not exists perguntas_relacionadas text,
  add column if not exists status text not null default 'pronto';

alter table public.base_conhecimento_itens
  drop constraint if exists base_conhecimento_itens_status_check;
alter table public.base_conhecimento_itens
  add constraint base_conhecimento_itens_status_check
  check (status in ('processando', 'pronto', 'erro'));

-- Índice de busca agora cobre conteúdo + perguntas geradas.
drop index if exists base_conhecimento_itens_fts;
create index base_conhecimento_itens_fts
  on public.base_conhecimento_itens
  using gin (to_tsvector('portuguese', conteudo || ' ' || coalesce(perguntas_relacionadas, '')));

-- Substitui a função de busca (definida na migration anterior) para casar com
-- o novo índice: agora ela também considera as perguntas geradas por IA.
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
    ts_rank(
      to_tsvector('portuguese', bci.conteudo || ' ' || coalesce(bci.perguntas_relacionadas, '')),
      websearch_to_tsquery('portuguese', p_mensagem)
    ) as rank
  from public.base_conhecimento_itens bci
  join public.base_conhecimento bc on bc.id = bci.base_id
  where bci.medico_id = p_medico_id
    and bc.ativo = true
    and p_ia = any(bc.ias)
    and to_tsvector('portuguese', bci.conteudo || ' ' || coalesce(bci.perguntas_relacionadas, ''))
        @@ websearch_to_tsquery('portuguese', p_mensagem)
  order by rank desc
  limit p_limit;
$$;
