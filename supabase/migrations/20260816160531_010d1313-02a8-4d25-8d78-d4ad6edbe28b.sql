CREATE OR REPLACE FUNCTION public.resposta_de_formulario_ativo(p_resposta_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.questionario_respostas r
    JOIN public.questionarios q ON q.id = r.questionario_id
    WHERE r.id = p_resposta_id AND q.ativo = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.resposta_de_formulario_ativo(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Publico grava itens de resposta" ON public.questionario_resposta_itens;

CREATE POLICY "Publico grava itens de resposta"
ON public.questionario_resposta_itens
FOR INSERT
TO anon, authenticated
WITH CHECK (public.resposta_de_formulario_ativo(resposta_id));