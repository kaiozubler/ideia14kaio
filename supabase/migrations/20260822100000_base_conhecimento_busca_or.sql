-- Problema observado: websearch_to_tsquery() combina as palavras da mensagem
-- com E lógico por padrão. Uma pergunta em linguagem natural como "Qual a
-- principal enzima responsável pela quebra da Anandamida?" exige então que
-- TODAS essas palavras (incluindo "qual") apareçam no mesmo trecho — o que
-- praticamente nunca acontece, mesmo quando o trecho é exatamente sobre o
-- assunto perguntado. Resultado: a busca não achava nada, e a IA respondia
-- "não encontrei na base local" incorretamente.
--
-- Fix: construir a consulta como OR entre os termos (qualquer um já
-- qualifica o trecho), e deixar o ts_rank() ordenar pelos que têm mais
-- termos em comum — muito mais tolerante a como a pergunta é formulada.
--
-- Precisa de DROP explícito: CREATE OR REPLACE não permite mudar a
-- assinatura de retorno (OUT params) de uma função já existente.
drop function if exists public.buscar_base_conhecimento(uuid, text, text, int);

create function public.buscar_base_conhecimento(
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
  v_query tsquery;
begin
  select to_tsquery('portuguese', string_agg(lexeme, ' | '))
    into v_query
  from unnest(tsvector_to_array(to_tsvector('portuguese', p_mensagem))) as lexeme;

  if v_query is null then
    return;
  end if;

  return query
  select
    bc.nome as base_nome,
    bci.conteudo,
    ts_rank(
      to_tsvector('portuguese', bci.conteudo || ' ' || coalesce(bci.perguntas_relacionadas, '')),
      v_query
    ) as rank
  from public.base_conhecimento_itens bci
  join public.base_conhecimento bc on bc.id = bci.base_id
  where bci.medico_id = p_medico_id
    and bc.ativo = true
    and p_ia = any(bc.ias)
    and to_tsvector('portuguese', bci.conteudo || ' ' || coalesce(bci.perguntas_relacionadas, ''))
        @@ v_query
  order by rank desc
  limit p_limit;
end;
$$;

notify pgrst, 'reload schema';
