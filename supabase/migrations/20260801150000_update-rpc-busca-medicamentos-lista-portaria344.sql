-- Migration: expõe lista_portaria344 nas funções de busca de medicamentos,
-- para permitir sinalizar no front-end o tipo de receita (A1, B2, C1, etc.)

DROP FUNCTION IF EXISTS public.buscar_genericos(text);
CREATE FUNCTION public.buscar_genericos(termo text)
returns table (
  id_substancia uuid,
  grupo_busca text,
  nome_exibicao text,
  qtd_fabricantes bigint,
  lista_portaria344 text
)
language sql stable set search_path = public as $$
  select s.id_substancia, s.grupo_busca, s.nome_exibicao,
         count(distinct m.fabricante) as qtd_fabricantes,
         s.lista_portaria344
  from public.substancias s
  join public.medicamento_substancias ms on ms.id_substancia = s.id_substancia
  join public.medicamentos m on m.id = ms.id_medicamento and m.is_generico = true
  where public.normaliza_substancia(s.grupo_busca) ilike '%' || public.normaliza_substancia(termo) || '%'
  group by s.id_substancia, s.grupo_busca, s.nome_exibicao, s.lista_portaria344
  order by s.nome_exibicao;
$$;

DROP FUNCTION IF EXISTS public.buscar_comerciais(text);
CREATE FUNCTION public.buscar_comerciais(termo text)
returns table (
  nome_comercial text,
  fabricante text,
  qtd_apresentacoes bigint,
  lista_portaria344 text
)
language sql stable set search_path = public as $$
  select m.nome_comercial, m.fabricante,
         count(distinct lower(trim(m.apresentacao))) as qtd_apresentacoes,
         string_agg(distinct s.lista_portaria344, ', ' order by s.lista_portaria344)
           filter (where s.lista_portaria344 is not null) as lista_portaria344
  from public.medicamentos m
  left join public.medicamento_substancias ms on ms.id_medicamento = m.id
  left join public.substancias s on s.id_substancia = ms.id_substancia
  where m.is_generico = false
    and public.normaliza_substancia(m.nome_comercial) ilike '%' || public.normaliza_substancia(termo) || '%'
  group by m.nome_comercial, m.fabricante
  order by m.nome_comercial
  limit 20;
$$;
