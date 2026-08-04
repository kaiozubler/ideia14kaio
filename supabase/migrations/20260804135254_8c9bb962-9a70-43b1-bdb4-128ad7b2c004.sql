CREATE OR REPLACE FUNCTION public.sincronizar_protocolo(p_protocolo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  r record;
BEGIN
  SELECT user_id INTO v_user FROM public.protocolos WHERE id = p_protocolo_id;
  IF v_user IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'Protocolo nao pertence ao usuario atual' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT paciente_id FROM public.pacientes WHERE user_id = v_user LOOP
    PERFORM public.sincronizar_protocolos_paciente(r.paciente_id);
  END LOOP;
  FOR r IN SELECT id FROM public.paciente_protocolos WHERE protocolo_id = p_protocolo_id AND ativo = true LOOP
    PERFORM public.gerar_tarefas_protocolo(r.id);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.sincronizar_protocolo(uuid) FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.sincronizar_protocolo(uuid) TO service_role;