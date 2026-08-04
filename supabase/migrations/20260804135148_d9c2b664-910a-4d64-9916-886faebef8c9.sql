-- 1) Harden SECURITY DEFINER protocol sync: require authenticated owner
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao requerida' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_user FROM public.protocolos WHERE id = p_protocolo_id;
  IF v_user IS NULL THEN RETURN; END IF;
  IF auth.uid() <> v_user THEN
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

-- 2) assinaturas_digitais: explicit restrictive deny for client writes
DROP POLICY IF EXISTS "Assinaturas sem insert pelo cliente" ON public.assinaturas_digitais;
DROP POLICY IF EXISTS "Assinaturas sem update pelo cliente" ON public.assinaturas_digitais;
DROP POLICY IF EXISTS "Assinaturas sem delete pelo cliente" ON public.assinaturas_digitais;
CREATE POLICY "Assinaturas sem insert pelo cliente" ON public.assinaturas_digitais
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "Assinaturas sem update pelo cliente" ON public.assinaturas_digitais
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "Assinaturas sem delete pelo cliente" ON public.assinaturas_digitais
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.assinaturas_digitais FROM authenticated, anon;

-- 3) doctor_certificates: convert deny policies to RESTRICTIVE
DROP POLICY IF EXISTS "Certificados sem insert pelo cliente" ON public.doctor_certificates;
DROP POLICY IF EXISTS "Certificados sem update pelo cliente" ON public.doctor_certificates;
DROP POLICY IF EXISTS "Certificados sem delete pelo cliente" ON public.doctor_certificates;
CREATE POLICY "Certificados sem insert pelo cliente" ON public.doctor_certificates
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "Certificados sem update pelo cliente" ON public.doctor_certificates
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "Certificados sem delete pelo cliente" ON public.doctor_certificates
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.doctor_certificates FROM authenticated, anon;