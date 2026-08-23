-- Problema observado: o OR puro entre termos (migration anterior) resolveu
-- o falso-negativo ("qual" quebrando o match), mas criou o oposto: qualquer
-- pergunta que compartilhe UMA palavra em comum com um trecho (ex.: a base é
-- sobre "Cannabis" e a pergunta nem é sobre isso, mas menciona algo que gera
-- o mesmo stem) já entrava no top-4 e a IA respondia com aquilo, mesmo sendo
-- irrelevante.
--
-- Fix: em vez de "qualquer termo qualifica" (OR puro) ou "todos os termos
-- são obrigatórios" (AND estrito, o problema original), exigimos uma FRAÇÃO
-- mínima dos termos distintos da pergunta (pelo menos ~40%, mínimo 2) —
-- filtra ruído sem voltar a exigir cada palavra da pergunta.
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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lexemes text[];
  v_query tsquery;
  v_min_termos int;
begin
  select array_agg(distinct lexeme) into v_lexemes
  from unnest(tsvector_to_array(to_tsvector('portuguese', p_mensagem))) as lexeme;

  if v_lexemes is null or array_length(v_lexemes, 1) = 0 then
    return;
  end if;

  v_query := to_tsquery('portuguese', array_to_string(v_lexemes, ' | '));

  v_min_termos := least(array_length(v_lexemes, 1), greatest(2, ceil(array_length(v_lexemes, 1) * 0.4)));

  return query
  select
    bc.nome as base_nome,
    bci.conteudo,
    ts_rank(d.doc_tsv, v_query) as rank
  from public.base_conhecimento_itens bci
  join public.base_conhecimento bc on bc.id = bci.base_id
  cross join lateral (
    select to_tsvector('portuguese', bci.conteudo || ' ' || coalesce(bci.perguntas_relacionadas, '')) as doc_tsv
  ) d
  where bci.medico_id = p_medico_id
    and bc.ativo = true
    and p_ia = any(bc.ias)
    and d.doc_tsv @@ v_query
    and (
      select count(*) from unnest(v_lexemes) as termo
      where d.doc_tsv @@ to_tsquery('portuguese', termo)
    ) >= v_min_termos
  order by rank desc
  limit p_limit;
end;
$$;

notify pgrst, 'reload schema';
