CREATE OR REPLACE FUNCTION public.vincular_resposta_ao_paciente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_paciente uuid;
BEGIN
  IF NEW.paciente_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT q.user_id INTO v_user_id FROM public.questionarios q WHERE q.id = NEW.questionario_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.paciente_cpf IS NOT NULL AND length(regexp_replace(NEW.paciente_cpf, '\D', '', 'g')) = 11 THEN
    SELECT p.paciente_id INTO v_paciente
    FROM public.pacientes p
    WHERE p.user_id = v_user_id
      AND regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g') = regexp_replace(NEW.paciente_cpf, '\D', '', 'g')
    LIMIT 1;
  END IF;

  IF v_paciente IS NULL AND NEW.paciente_telefone IS NOT NULL AND length(regexp_replace(NEW.paciente_telefone, '\D', '', 'g')) >= 10 THEN
    SELECT p.paciente_id INTO v_paciente
    FROM public.pacientes p
    WHERE p.user_id = v_user_id
      AND right(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), 10) = right(regexp_replace(NEW.paciente_telefone, '\D', '', 'g'), 10)
    LIMIT 1;
  END IF;

  NEW.paciente_id := v_paciente;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_resposta_ao_paciente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vincular_resposta_ao_paciente ON public.questionario_respostas;
CREATE TRIGGER trg_vincular_resposta_ao_paciente
BEFORE INSERT ON public.questionario_respostas
FOR EACH ROW EXECUTE FUNCTION public.vincular_resposta_ao_paciente();

DELETE FROM public.questionario_respostas WHERE paciente_nome = 'Paciente Teste Playwright';