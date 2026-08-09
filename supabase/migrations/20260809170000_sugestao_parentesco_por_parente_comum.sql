-- Sugere parentesco por "parente em comum": se o paciente X já está vinculado
-- a Y, e Y já está vinculado a Z, o sistema tenta inferir o que Z é de X
-- (ex: X e Z têm o mesmo Pai Y => são irmãos), mesmo que X e Z não tenham
-- sobrenome parecido. É somente uma sugestão clicável, igual à de sobrenome —
-- nada é vinculado sozinho.

CREATE OR REPLACE FUNCTION public.parentesco_papel_composto(papel1 text, papel2 text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- papel1 = o que Y é para X · papel2 = o que Z é para Y · resultado = o que Z é para X
  SELECT CASE
    WHEN papel1='parent'     AND papel2='parent'     THEN 'grandparent'
    WHEN papel1='parent'     AND papel2='child'      THEN 'sibling'
    WHEN papel1='parent'     AND papel2='sibling'    THEN 'uncle_aunt'
    WHEN papel1='parent'     AND papel2='grandparent' THEN 'great_grandparent'
    WHEN papel1='child'      AND papel2='child'      THEN 'grandchild'
    WHEN papel1='sibling'    AND papel2='sibling'    THEN 'sibling'
    WHEN papel1='sibling'    AND papel2='child'      THEN 'nephew_niece'
    WHEN papel1='grandparent' AND papel2='child'     THEN 'uncle_aunt'
    WHEN papel1='grandparent' AND papel2='parent'    THEN 'great_grandparent'
    WHEN papel1='uncle_aunt' AND papel2='child'      THEN 'cousin'
    ELSE NULL
  END;
$$;

DROP FUNCTION IF EXISTS public.buscar_parentes_possiveis(uuid, integer);

CREATE FUNCTION public.buscar_parentes_possiveis(p_paciente_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(paciente_id uuid, name text, cpf text, data_nascimento date, parentesco_sugerido text, motivo text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT p.paciente_id, p.user_id, p.name, p.parentescos
    FROM public.pacientes p
    WHERE p.paciente_id = p_paciente_id AND p.user_id = auth.uid()
  ),
  vinculados AS (
    SELECT (x->>'paciente_id')::uuid AS pid
    FROM base b, jsonb_array_elements(coalesce(b.parentescos,'[]'::jsonb)) x
    WHERE coalesce(x->>'paciente_id','') <> ''
  ),
  por_sobrenome AS (
    SELECT o.paciente_id, o.name, o.cpf, o.data_nascimento,
           NULL::text AS parentesco_sugerido,
           'Mesmo sobrenome: ' || public.sobrenome_paciente(o.name) AS motivo
    FROM base b
    JOIN public.pacientes o
      ON o.user_id = b.user_id
     AND o.paciente_id <> b.paciente_id
     AND public.sobrenome_paciente(o.name) IS NOT NULL
     AND public.sobrenome_paciente(o.name) = public.sobrenome_paciente(b.name)
    WHERE o.paciente_id NOT IN (SELECT pid FROM vinculados)
  ),
  por_parente_comum AS (
    SELECT DISTINCT ON (z.paciente_id)
      z.paciente_id, z.name, z.cpf, z.data_nascimento,
      public.parentesco_termo_por_papel(
        public.parentesco_papel_composto(
          public.parentesco_papel(xy->>'parentesco'),
          public.parentesco_papel(yz->>'parentesco')
        ),
        z.sexo
      ) AS parentesco_sugerido,
      'Parente em comum: ' || y.name AS motivo
    FROM base b
    JOIN LATERAL jsonb_array_elements(coalesce(b.parentescos,'[]'::jsonb)) xy
      ON coalesce(xy->>'paciente_id','') <> ''
    JOIN public.pacientes y ON y.paciente_id = (xy->>'paciente_id')::uuid AND y.user_id = b.user_id
    JOIN LATERAL jsonb_array_elements(coalesce(y.parentescos,'[]'::jsonb)) yz
      ON coalesce(yz->>'paciente_id','') <> ''
    JOIN public.pacientes z ON z.paciente_id = (yz->>'paciente_id')::uuid AND z.user_id = b.user_id
    WHERE z.paciente_id <> b.paciente_id
      AND z.paciente_id NOT IN (SELECT pid FROM vinculados)
      AND public.parentesco_papel_composto(
            public.parentesco_papel(xy->>'parentesco'),
            public.parentesco_papel(yz->>'parentesco')
          ) IS NOT NULL
    ORDER BY z.paciente_id, y.name
  ),
  combinado AS (
    SELECT * FROM por_parente_comum
    UNION ALL
    SELECT * FROM por_sobrenome
  )
  SELECT DISTINCT ON (paciente_id) paciente_id, name, cpf, data_nascimento, parentesco_sugerido, motivo
  FROM combinado
  ORDER BY paciente_id, parentesco_sugerido NULLS LAST, name
  LIMIT least(greatest(coalesce(p_limit,20),1),100);
$$;

REVOKE ALL ON FUNCTION public.buscar_parentes_possiveis(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.buscar_parentes_possiveis(uuid, integer) TO authenticated;
