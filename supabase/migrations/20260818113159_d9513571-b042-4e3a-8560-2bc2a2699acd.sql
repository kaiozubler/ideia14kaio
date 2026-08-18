
DROP POLICY IF EXISTS "Publico ve formularios ativos" ON public.questionarios;
DROP POLICY IF EXISTS "Publico ve perguntas de formularios ativos" ON public.questionario_perguntas;

REVOKE SELECT ON public.questionarios FROM anon;
REVOKE SELECT ON public.questionario_perguntas FROM anon;

CREATE OR REPLACE FUNCTION public.formulario_publico(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', q.id,
    'titulo', q.titulo,
    'descricao', q.descricao,
    'anonimo', q.anonimo,
    'ativo', q.ativo,
    'campos_cadastro', q.campos_cadastro,
    'questionario_perguntas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'ordem', p.ordem,
        'tipo', p.tipo,
        'enunciado', p.enunciado,
        'opcoes', p.opcoes,
        'escala_min', p.escala_min,
        'escala_max', p.escala_max,
        'escala_label_min', p.escala_label_min,
        'escala_label_max', p.escala_label_max,
        'obrigatoria', p.obrigatoria,
        'longa', p.longa
      ) ORDER BY p.ordem)
      FROM public.questionario_perguntas p
      WHERE p.questionario_id = q.id
    ), '[]'::jsonb)
  )
  FROM public.questionarios q
  WHERE q.id = p_id AND q.ativo = true
$$;

REVOKE ALL ON FUNCTION public.formulario_publico(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.formulario_publico(uuid) TO anon, authenticated, service_role;
