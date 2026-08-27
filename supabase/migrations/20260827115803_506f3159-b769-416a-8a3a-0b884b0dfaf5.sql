DROP FUNCTION IF EXISTS public.listar_apresentacoes_comercial(text, text);
DROP FUNCTION IF EXISTS public.listar_apresentacoes_generico(uuid, text);

CREATE OR REPLACE FUNCTION public.listar_apresentacoes_comercial(p_nome_comercial text, p_fabricante text DEFAULT NULL::text)
RETURNS TABLE(apresentacao text, apresentacao_original text, posologia_padrao text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT
         COALESCE(NULLIF(m.apresentacao_simplificada, ''), m.apresentacao) AS apresentacao,
         m.apresentacao AS apresentacao_original,
         m.posologia_padrao
  FROM public.medicamentos m
  WHERE m.is_generico = false
    AND m.nome_comercial = p_nome_comercial
    AND m.apresentacao IS NOT NULL
    AND (p_fabricante IS NULL OR m.fabricante = p_fabricante)
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.listar_apresentacoes_generico(p_id_substancia uuid, p_fabricante text DEFAULT NULL::text)
RETURNS TABLE(apresentacao text, apresentacao_original text, posologia_padrao text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT
         COALESCE(NULLIF(m.apresentacao_simplificada, ''), m.apresentacao) AS apresentacao,
         m.apresentacao AS apresentacao_original,
         m.posologia_padrao
  FROM public.medicamentos m
  JOIN public.medicamento_substancias ms ON ms.id_medicamento = m.id
  WHERE ms.id_substancia = p_id_substancia
    AND m.is_generico = true
    AND m.apresentacao IS NOT NULL
    AND (p_fabricante IS NULL OR m.fabricante = p_fabricante)
  ORDER BY 1;
$function$;

REVOKE ALL ON FUNCTION public.listar_apresentacoes_comercial(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.listar_apresentacoes_generico(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_apresentacoes_comercial(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.listar_apresentacoes_generico(uuid, text) TO authenticated, service_role;