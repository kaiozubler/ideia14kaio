-- PASSO 1
create or replace function public.grupo_busca_substancia(nome_dcb text)
returns text language sql immutable set search_path = public as $$
  select trim(regexp_replace(upper(coalesce(nome_dcb,'')),
    '\s+(SODIC[AO]|POTASSIC[AO]|CALCIC[AO]|MAGNESIC[AO]|MONOIDRATAD[AO]|DIIDRATAD[AO]|TRIIDRATAD[AO]|HEMIIDRATAD[AO]|ANIDR[AO]|CLORIDRATO|DICLORIDRATO|BESILATO|MALEATO|SUCCINATO|FUMARATO|TARTARATO|CITRATO|FOSFATO|SULFATO|ACETATO|BROMIDRATO|MESILATO|NITRATO|CARBONATO)\y.*$',''));
$$;

alter table public.substancias add column if not exists grupo_busca text;

update public.substancias
set grupo_busca = public.grupo_busca_substancia(nome_dcb)
where grupo_busca is distinct from public.grupo_busca_substancia(nome_dcb);

create index if not exists idx_substancias_grupo_busca on public.substancias (grupo_busca);

do $$
begin
  create temporary table _map_subs on commit drop as
  select id_substancia as id_old,
         first_value(id_substancia) over (partition by grupo_busca order by id_substancia) as id_new
  from public.substancias
  where grupo_busca is not null;

  delete from _map_subs where id_old = id_new;

  create temporary table _ms_new on commit drop as
  select distinct on (ms.id_medicamento, coalesce(m.id_new, ms.id_substancia))
    ms.id_medicamento,
    coalesce(m.id_new, ms.id_substancia) as id_substancia,
    ms.concentracao
  from public.medicamento_substancias ms
  left join _map_subs m on m.id_old = ms.id_substancia
  order by ms.id_medicamento, coalesce(m.id_new, ms.id_substancia), ms.ctid;

  delete from public.medicamento_substancias;
  insert into public.medicamento_substancias (id_medicamento, id_substancia, concentracao)
  select id_medicamento, id_substancia, concentracao from _ms_new;

  create temporary table _int_new on commit drop as
  select distinct on (least(a_new, b_new), greatest(a_new, b_new))
    id_interacao, a_new as id_substancia_a, b_new as id_substancia_b,
    gravidade, descricao, fonte, created_at
  from (
    select i.id_interacao,
      coalesce(ma.id_new, i.id_substancia_a) as a_new,
      coalesce(mb.id_new, i.id_substancia_b) as b_new,
      i.gravidade, i.descricao, i.fonte, i.created_at, i.ctid
    from public.interacoes_medicamentosas i
    left join _map_subs ma on ma.id_old = i.id_substancia_a
    left join _map_subs mb on mb.id_old = i.id_substancia_b
  ) x
  where a_new <> b_new
  order by least(a_new, b_new), greatest(a_new, b_new), ctid;

  delete from public.interacoes_medicamentosas;
  insert into public.interacoes_medicamentosas (id_interacao, id_substancia_a, id_substancia_b, gravidade, descricao, fonte, created_at)
  select id_interacao, id_substancia_a, id_substancia_b, gravidade, descricao, fonte, created_at from _int_new;

  delete from public.substancias s using _map_subs m where s.id_substancia = m.id_old;
end $$;

update public.substancias
set nome_exibicao = initcap(lower(grupo_busca))
where grupo_busca is not null;

-- PASSO 3
alter table public.medicamentos drop column if exists compostos;
alter table public.medicamentos drop column if exists apresentacoes;
alter table public.medicamentos drop column if exists composicao;

-- remover NOT NULL antes de setar null
alter table public.medicamentos alter column nome_comercial drop not null;
update public.medicamentos set nome_comercial = null where is_generico = true;

-- PASSO 4
create or replace function public.buscar_genericos(termo text)
returns table (id_substancia uuid, grupo_busca text, nome_exibicao text, qtd_fabricantes bigint)
language sql stable set search_path = public as $$
  select s.id_substancia, s.grupo_busca, s.nome_exibicao,
         count(distinct m.fabricante) as qtd_fabricantes
  from public.substancias s
  join public.medicamento_substancias ms on ms.id_substancia = s.id_substancia
  join public.medicamentos m on m.id = ms.id_medicamento and m.is_generico = true
  where public.normaliza_substancia(s.grupo_busca) ilike '%' || public.normaliza_substancia(termo) || '%'
  group by s.id_substancia, s.grupo_busca, s.nome_exibicao
  order by s.nome_exibicao;
$$;

create or replace function public.buscar_comerciais(termo text)
returns table (nome_comercial text, fabricante text, qtd_apresentacoes bigint)
language sql stable set search_path = public as $$
  select m.nome_comercial, m.fabricante,
         count(distinct lower(trim(m.apresentacao))) as qtd_apresentacoes
  from public.medicamentos m
  where m.is_generico = false
    and public.normaliza_substancia(m.nome_comercial) ilike '%' || public.normaliza_substancia(termo) || '%'
  group by m.nome_comercial, m.fabricante
  order by m.nome_comercial
  limit 20;
$$;

create or replace function public.listar_fabricantes_generico(p_id_substancia uuid)
returns table (fabricante text, qtd_apresentacoes bigint)
language sql stable set search_path = public as $$
  select m.fabricante, count(distinct lower(trim(m.apresentacao)))
  from public.medicamento_substancias ms
  join public.medicamentos m on m.id = ms.id_medicamento and m.is_generico = true
  where ms.id_substancia = p_id_substancia and m.fabricante is not null
  group by m.fabricante
  order by m.fabricante;
$$;

create or replace function public.listar_apresentacoes_generico(p_id_substancia uuid, p_fabricante text default null)
returns table (apresentacao text, registro_anvisa text, fabricante text)
language sql stable set search_path = public as $$
  select distinct on (lower(trim(m.apresentacao)))
    trim(m.apresentacao), m.registro_anvisa, m.fabricante
  from public.medicamento_substancias ms
  join public.medicamentos m on m.id = ms.id_medicamento and m.is_generico = true
  where ms.id_substancia = p_id_substancia
    and (p_fabricante is null or m.fabricante = p_fabricante)
  order by lower(trim(m.apresentacao));
$$;

create or replace function public.listar_apresentacoes_comercial(p_nome_comercial text, p_fabricante text)
returns table (apresentacao text, registro_anvisa text)
language sql stable set search_path = public as $$
  select distinct on (lower(trim(m.apresentacao)))
    trim(m.apresentacao), m.registro_anvisa
  from public.medicamentos m
  where m.nome_comercial = p_nome_comercial
    and m.fabricante = p_fabricante
    and m.is_generico = false
  order by lower(trim(m.apresentacao));
$$;