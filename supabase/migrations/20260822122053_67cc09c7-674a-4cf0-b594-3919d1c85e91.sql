CREATE OR REPLACE FUNCTION public.buscar_base_conhecimento(
  p_medico_id uuid,
  p_mensagem text,
  p_ia text,
  p_limit integer DEFAULT 4
)
RETURNS TABLE(base_nome text, conteudo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.nome, i.conteudo
  FROM public.base_conhecimento_itens i
  JOIN public.base_conhecimento b ON b.id = i.base_id
  WHERE b.medico_id = p_medico_id
    AND b.ativo IS TRUE
    AND b.ias @> ARRAY[p_ia]
    AND i.conteudo % p_mensagem
  ORDER BY similarity(i.conteudo, p_mensagem) DESC
  LIMIT COALESCE(p_limit, 4);
$$;

REVOKE ALL ON FUNCTION public.buscar_base_conhecimento(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_base_conhecimento(uuid, text, text, integer) TO service_role;

ALTER TABLE public.base_conhecimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_conhecimento_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_comandos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_conhecimento TO authenticated;
GRANT ALL ON public.base_conhecimento TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_conhecimento_itens TO authenticated;
GRANT ALL ON public.base_conhecimento_itens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_comandos TO authenticated;
GRANT ALL ON public.prompt_comandos TO service_role;

CREATE POLICY "medico gerencia suas bases" ON public.base_conhecimento
  FOR ALL TO authenticated USING (medico_id = auth.uid()) WITH CHECK (medico_id = auth.uid());

CREATE POLICY "medico gerencia itens das suas bases" ON public.base_conhecimento_itens
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.base_conhecimento b WHERE b.id = base_id AND b.medico_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.base_conhecimento b WHERE b.id = base_id AND b.medico_id = auth.uid()));

CREATE POLICY "medico gerencia seus comandos" ON public.prompt_comandos
  FOR ALL TO authenticated USING (medico_id = auth.uid()) WITH CHECK (medico_id = auth.uid());