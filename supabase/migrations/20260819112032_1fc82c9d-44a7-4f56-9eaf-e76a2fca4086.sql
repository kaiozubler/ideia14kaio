ALTER TABLE public.questionarios ADD COLUMN IF NOT EXISTS exigir_auth_email boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.questionario_email_codigos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  questionario_id uuid NOT NULL REFERENCES public.questionarios(id) ON DELETE CASCADE,
  email text NOT NULL,
  codigo text NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  verificado boolean NOT NULL DEFAULT false,
  expira_em timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.questionario_email_codigos TO service_role;
ALTER TABLE public.questionario_email_codigos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_qec_lookup ON public.questionario_email_codigos (questionario_id, email, created_at DESC);

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
    'exigir_auth_email', q.exigir_auth_email,
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