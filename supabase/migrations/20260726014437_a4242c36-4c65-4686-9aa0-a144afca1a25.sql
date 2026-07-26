CREATE OR REPLACE FUNCTION public.vincular_crfmg_substancias()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.medicamentos_crfmg mc
  SET id_substancia = s.id_substancia
  FROM public.substancias s
  WHERE mc.id_substancia IS DISTINCT FROM s.id_substancia
    AND s.id_substancia = (
      SELECT s2.id_substancia
      FROM public.substancias s2
      WHERE public.normaliza_substancia(s2.grupo_busca) = mc.nome_normalizado
         OR public.normaliza_substancia(s2.nome_exibicao) = mc.nome_normalizado
      ORDER BY length(s2.nome_exibicao)
      LIMIT 1
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.substancias s
  SET api_id = mc.api_id
  FROM public.medicamentos_crfmg mc
  WHERE mc.id_substancia = s.id_substancia
    AND s.api_id IS DISTINCT FROM mc.api_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vincular_crfmg_substancias() TO service_role;