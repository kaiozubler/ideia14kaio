CREATE OR REPLACE FUNCTION public.sincronizar_apresentacao_legivel()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.medicamentos m
  SET apresentacao_simplificada = a.texto_simplificado,
      posologia_padrao = COALESCE(a.posologia_padrao, m.posologia_padrao)
  FROM public.apresentacao_legivel a
  WHERE m.apresentacao = a.apresentacao
    AND (m.apresentacao_simplificada IS DISTINCT FROM a.texto_simplificado
         OR m.posologia_padrao IS NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_apresentacao_legivel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_apresentacao_legivel() TO service_role;