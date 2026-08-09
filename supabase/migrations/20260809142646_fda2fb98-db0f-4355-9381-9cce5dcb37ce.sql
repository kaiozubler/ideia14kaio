ALTER TABLE public.pacientes
  ADD COLUMN IF NOT EXISTS parentescos jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.sobrenome_paciente(nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(upper(regexp_replace(regexp_replace(coalesce(nome,''), '\s+$', ''), '^.*\s', '')), '');
$$;

CREATE INDEX IF NOT EXISTS idx_pacientes_nome_trgm
  ON public.pacientes USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pacientes_cpf
  ON public.pacientes (regexp_replace(coalesce(cpf,''), '\D', '', 'g'));
CREATE INDEX IF NOT EXISTS idx_pacientes_sobrenome
  ON public.pacientes (public.sobrenome_paciente(name));
CREATE INDEX IF NOT EXISTS idx_pacientes_parentescos
  ON public.pacientes USING gin (parentescos);

-- Busca de pacientes por nome ou CPF (para vincular parentes)
CREATE OR REPLACE FUNCTION public.buscar_pacientes(termo text, p_limit integer DEFAULT 20)
RETURNS TABLE(paciente_id uuid, name text, cpf text, data_nascimento date, sobrenome text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH t AS (
    SELECT nullif(trim(coalesce(termo,'')),'') AS q,
           nullif(regexp_replace(coalesce(termo,''), '\D', '', 'g'),'') AS d
  )
  SELECT p.paciente_id, p.name, p.cpf, p.data_nascimento, public.sobrenome_paciente(p.name)
  FROM public.pacientes p, t
  WHERE p.user_id = auth.uid()
    AND (
      t.q IS NULL
      OR lower(public.unaccent(p.name)) LIKE '%' || lower(public.unaccent(t.q)) || '%'
      OR (t.d IS NOT NULL AND regexp_replace(coalesce(p.cpf,''), '\D', '', 'g') LIKE t.d || '%')
    )
  ORDER BY similarity(lower(public.unaccent(p.name)), lower(public.unaccent(coalesce(t.q,'')))) DESC, p.name
  LIMIT least(greatest(coalesce(p_limit,20),1),100);
$$;

-- Possíveis parentes: mesmo sobrenome, excluindo já vinculados
CREATE OR REPLACE FUNCTION public.buscar_parentes_possiveis(p_paciente_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(paciente_id uuid, name text, cpf text, data_nascimento date, sobrenome text, motivo text)
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
  )
  SELECT o.paciente_id, o.name, o.cpf, o.data_nascimento,
         public.sobrenome_paciente(o.name),
         'Mesmo sobrenome: ' || public.sobrenome_paciente(o.name)
  FROM base b
  JOIN public.pacientes o
    ON o.user_id = b.user_id
   AND o.paciente_id <> b.paciente_id
   AND public.sobrenome_paciente(o.name) IS NOT NULL
   AND public.sobrenome_paciente(o.name) = public.sobrenome_paciente(b.name)
  WHERE o.paciente_id NOT IN (SELECT pid FROM vinculados)
  ORDER BY o.name
  LIMIT least(greatest(coalesce(p_limit,20),1),100);
$$;

-- Histórico familiar: CIDs dos parentes (vínculo nos dois sentidos)
CREATE OR REPLACE FUNCTION public.historico_familiar_cids(p_paciente_id uuid)
RETURNS TABLE(parente_id uuid, parente_nome text, parentesco text, grau text, cid_code text, cid_descricao text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT p.paciente_id, p.user_id, p.parentescos
    FROM public.pacientes p
    WHERE p.paciente_id = p_paciente_id AND p.user_id = auth.uid()
  ),
  diretos AS (
    SELECT (x->>'paciente_id')::uuid AS pid,
           nullif(x->>'parentesco','') AS parentesco,
           nullif(x->>'grau','') AS grau
    FROM base b, jsonb_array_elements(coalesce(b.parentescos,'[]'::jsonb)) x
    WHERE coalesce(x->>'paciente_id','') <> ''
  ),
  inversos AS (
    SELECT o.paciente_id AS pid,
           nullif(x->>'parentesco','') AS parentesco,
           nullif(x->>'grau','') AS grau
    FROM base b
    JOIN public.pacientes o ON o.user_id = b.user_id AND o.paciente_id <> b.paciente_id
    CROSS JOIN jsonb_array_elements(coalesce(o.parentescos,'[]'::jsonb)) x
    WHERE (x->>'paciente_id')::text = b.paciente_id::text
  ),
  todos AS (
    SELECT DISTINCT ON (pid) pid, parentesco, grau
    FROM (SELECT * FROM diretos UNION ALL SELECT * FROM inversos) u
    ORDER BY pid, parentesco NULLS LAST
  )
  SELECT r.paciente_id, r.name, t.parentesco, t.grau,
         c->>'code', c->>'description'
  FROM todos t
  JOIN public.pacientes r ON r.paciente_id = t.pid AND r.user_id = auth.uid()
  LEFT JOIN LATERAL jsonb_array_elements(coalesce(r.cids,'[]'::jsonb)) c ON true
  ORDER BY r.name, c->>'code';
$$;

REVOKE ALL ON FUNCTION public.buscar_pacientes(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.buscar_parentes_possiveis(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.historico_familiar_cids(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.buscar_pacientes(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_parentes_possiveis(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.historico_familiar_cids(uuid) TO authenticated;