-- Base de ajuda do produto (FAQ de uso do app) em `base_conhecimento_sistema_itens`.
--
-- O conteúdo vive em docs/ajuda/*.md e é sincronizado pelo servidor
-- (src/lib/ajuda/sincronizar.server.ts): cada pergunta vira uma linha com
-- `origem = 'ajuda'`, identificada por `chave` e gravada só quando o `hash`
-- muda. Linhas criadas à mão (origem 'manual', chave nula) nunca são tocadas.

alter table public.base_conhecimento_sistema_itens
  add column if not exists chave text,
  add column if not exists hash text,
  add column if not exists origem text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'base_conhecimento_sistema_itens_chave_key'
  ) then
    alter table public.base_conhecimento_sistema_itens
      add constraint base_conhecimento_sistema_itens_chave_key unique (chave);
  end if;
end $$;

-- unaccent é STABLE; o wrapper IMMUTABLE fixa o dicionário para poder ser usado na busca.
create or replace function public.ajuda_sem_acento(t text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select public.unaccent('public.unaccent'::regdictionary, coalesce(t, ''))
$$;

-- Busca da base do sistema, agora:
-- - sem acento dos dois lados ("prontuario" acha "prontuário");
-- - com OU entre as palavras (antes exigia todas, e uma pergunta comum como
--   "como faço pra cancelar meu plano" não achava nada);
-- - pesando título (pergunta) > palavras-chave > texto da resposta.
-- A tabela é pequena (centenas de linhas), então o vetor é montado na hora.
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
  with q as (
    select nullif(
      replace(plainto_tsquery('portuguese', public.ajuda_sem_acento(left(p_mensagem, 500)))::text, ' & ', ' | '),
      ''
    )::tsquery as consulta
  ),
  docs as (
    select
      b.titulo,
      b.conteudo,
      b.ordem,
      setweight(to_tsvector('portuguese', public.ajuda_sem_acento(b.titulo)), 'A')
        || setweight(to_tsvector('portuguese', public.ajuda_sem_acento(array_to_string(b.tags, ' '))), 'B')
        || setweight(to_tsvector('portuguese', public.ajuda_sem_acento(b.conteudo)), 'C') as vetor
    from public.base_conhecimento_sistema_itens b
    where b.ativo = true
  )
  select d.titulo, d.conteudo, ts_rank(d.vetor, q.consulta) as rank
  from docs d, q
  where q.consulta is not null
    and d.vetor @@ q.consulta
  order by rank desc, d.ordem
  limit least(greatest(coalesce(p_limit, 4), 1), 10);
$$;
