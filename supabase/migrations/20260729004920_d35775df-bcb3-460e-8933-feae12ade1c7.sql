CREATE OR REPLACE FUNCTION public.sincronizar_protocolos_paciente(p_paciente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid;
  v_cids text[];
  r record;
  v_id uuid;
BEGIN
  SELECT user_id,
         COALESCE(ARRAY(
           SELECT upper(trim(x->>'code'))
           FROM jsonb_array_elements(COALESCE(cids, '[]'::jsonb)) x
           WHERE COALESCE(x->>'code','') <> ''
         ), ARRAY[]::text[])
    INTO v_user, v_cids
  FROM public.pacientes WHERE paciente_id = p_paciente_id;

  IF v_user IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'Paciente nao pertence ao usuario atual' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.paciente_protocolos pp
  WHERE pp.paciente_id = p_paciente_id
    AND NOT EXISTS (
      SELECT 1 FROM public.protocolo_cids pc
      WHERE pc.protocolo_id = pp.protocolo_id
        AND upper(pc.cid_code) = ANY(v_cids)
    );

  FOR r IN
    SELECT DISTINCT p.id AS protocolo_id,
           (SELECT upper(pc2.cid_code) FROM public.protocolo_cids pc2
             WHERE pc2.protocolo_id = p.id AND upper(pc2.cid_code) = ANY(v_cids) LIMIT 1) AS cid_code
    FROM public.protocolos p
    JOIN public.protocolo_cids pc ON pc.protocolo_id = p.id
    WHERE p.user_id = v_user
      AND p.ativo = true
      AND upper(pc.cid_code) = ANY(v_cids)
  LOOP
    INSERT INTO public.paciente_protocolos (user_id, paciente_id, protocolo_id, cid_code)
    VALUES (v_user, p_paciente_id, r.protocolo_id, r.cid_code)
    ON CONFLICT (paciente_id, protocolo_id) DO UPDATE SET ativo = true, cid_code = EXCLUDED.cid_code
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      PERFORM public.gerar_tarefas_protocolo(v_id);
    END IF;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sincronizar_protocolo(p_protocolo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.sincronizar_protocolos_paciente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sincronizar_protocolo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_protocolos_paciente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_protocolo(uuid) TO authenticated;