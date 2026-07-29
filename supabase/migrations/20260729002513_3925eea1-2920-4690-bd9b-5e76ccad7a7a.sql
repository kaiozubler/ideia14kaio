-- 1) documentos_paciente: garantir que paciente_id pertence ao id_medico
CREATE OR REPLACE FUNCTION public.validar_paciente_do_medico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.paciente_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pacientes p
      WHERE p.paciente_id = NEW.paciente_id
        AND p.user_id = NEW.id_medico
    ) THEN
      RAISE EXCEPTION 'Paciente % nao pertence ao medico %', NEW.paciente_id, NEW.id_medico
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documentos_paciente_validar_vinculo ON public.documentos_paciente;
CREATE TRIGGER trg_documentos_paciente_validar_vinculo
BEFORE INSERT OR UPDATE OF paciente_id, id_medico ON public.documentos_paciente
FOR EACH ROW EXECUTE FUNCTION public.validar_paciente_do_medico();

-- 2) signature_pkce_sessions: bloqueio explicito para clientes; apenas service_role
ALTER TABLE public.signature_pkce_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signature_pkce_sessions FROM anon, authenticated;
GRANT ALL ON public.signature_pkce_sessions TO service_role;

DROP POLICY IF EXISTS "No client access to pkce sessions" ON public.signature_pkce_sessions;
CREATE POLICY "No client access to pkce sessions"
ON public.signature_pkce_sessions
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);