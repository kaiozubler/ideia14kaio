-- Retorna o grafo familiar (nós = pacientes, arestas = parentescos) em um único JSON,
-- pronto para o front-end desenhar o mapa mental / árvore genealógica.
-- Se p_paciente_id for informado, retorna só o componente conectado a esse paciente
-- (o próprio paciente + todos os parentes alcançáveis por vínculo, direto ou indireto).
-- Se p_paciente_id for NULL, retorna o grafo com todos os pacientes do médico que
-- têm pelo menos um parentesco vinculado.

CREATE OR REPLACE FUNCTION public.grafo_familiar(p_paciente_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE alcancaveis AS (
    SELECT p_paciente_id AS paciente_id
    WHERE p_paciente_id IS NOT NULL
    UNION
    SELECT (x->>'paciente_id')::uuid
    FROM alcancaveis a
    JOIN public.pacientes p ON p.paciente_id = a.paciente_id AND p.user_id = auth.uid()
    CROSS JOIN jsonb_array_elements(coalesce(p.parentescos,'[]'::jsonb)) x
    WHERE coalesce(x->>'paciente_id','') <> ''
  ),
  nos AS (
    SELECT p.paciente_id, p.name, p.sexo, p.data_nascimento, coalesce(p.cids,'[]'::jsonb) AS cids
    FROM public.pacientes p
    WHERE p.user_id = auth.uid()
      AND (
        (p_paciente_id IS NOT NULL AND p.paciente_id IN (SELECT paciente_id FROM alcancaveis))
        OR (p_paciente_id IS NULL AND jsonb_array_length(coalesce(p.parentescos,'[]'::jsonb)) > 0)
      )
  ),
  arestas AS (
    SELECT DISTINCT ON (LEAST(p.paciente_id,(x->>'paciente_id')::uuid), GREATEST(p.paciente_id,(x->>'paciente_id')::uuid))
      p.paciente_id AS origem,
      (x->>'paciente_id')::uuid AS destino,
      nullif(x->>'parentesco','') AS parentesco,
      nullif(x->>'grau','') AS grau
    FROM public.pacientes p
    CROSS JOIN jsonb_array_elements(coalesce(p.parentescos,'[]'::jsonb)) x
    WHERE p.user_id = auth.uid()
      AND coalesce(x->>'paciente_id','') <> ''
      AND p.paciente_id IN (SELECT paciente_id FROM nos)
      AND (x->>'paciente_id')::uuid IN (SELECT paciente_id FROM nos)
    ORDER BY LEAST(p.paciente_id,(x->>'paciente_id')::uuid),
             GREATEST(p.paciente_id,(x->>'paciente_id')::uuid),
             (p.paciente_id <> LEAST(p.paciente_id,(x->>'paciente_id')::uuid))
  )
  SELECT jsonb_build_object(
    'nodes', coalesce((SELECT jsonb_agg(jsonb_build_object('id',paciente_id,'nome',name,'sexo',sexo,'nascimento',data_nascimento,'cids',cids)) FROM nos),'[]'::jsonb),
    'edges', coalesce((SELECT jsonb_agg(jsonb_build_object('origem',origem,'destino',destino,'parentesco',parentesco,'grau',grau)) FROM arestas),'[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.grafo_familiar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.grafo_familiar(uuid) TO authenticated;
