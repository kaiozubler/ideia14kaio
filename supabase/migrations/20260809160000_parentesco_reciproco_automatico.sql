-- Preenche automaticamente o parentesco recíproco no paciente vinculado.
-- Ex: se o paciente A marca "Filho" apontando para o paciente B,
-- o paciente B passa a ter, na lista dele, o paciente A marcado como "Pai" ou "Mãe"
-- (dependendo do sexo cadastrado do paciente A).

CREATE OR REPLACE FUNCTION public.parentesco_papel(termo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE termo
    WHEN 'Pai' THEN 'parent' WHEN 'Mãe' THEN 'parent'
    WHEN 'Filho' THEN 'child' WHEN 'Filha' THEN 'child'
    WHEN 'Avô' THEN 'grandparent' WHEN 'Avó' THEN 'grandparent'
    WHEN 'Neto' THEN 'grandchild' WHEN 'Neta' THEN 'grandchild'
    WHEN 'Bisavô' THEN 'great_grandparent' WHEN 'Bisavó' THEN 'great_grandparent'
    WHEN 'Bisneto' THEN 'great_grandchild' WHEN 'Bisneta' THEN 'great_grandchild'
    WHEN 'Tio' THEN 'uncle_aunt' WHEN 'Tia' THEN 'uncle_aunt'
    WHEN 'Sobrinho' THEN 'nephew_niece' WHEN 'Sobrinha' THEN 'nephew_niece'
    WHEN 'Irmão' THEN 'sibling' WHEN 'Irmã' THEN 'sibling'
    WHEN 'Primo' THEN 'cousin' WHEN 'Prima' THEN 'cousin'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.parentesco_papel_oposto(papel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE papel
    WHEN 'parent' THEN 'child' WHEN 'child' THEN 'parent'
    WHEN 'grandparent' THEN 'grandchild' WHEN 'grandchild' THEN 'grandparent'
    WHEN 'great_grandparent' THEN 'great_grandchild' WHEN 'great_grandchild' THEN 'great_grandparent'
    WHEN 'uncle_aunt' THEN 'nephew_niece' WHEN 'nephew_niece' THEN 'uncle_aunt'
    WHEN 'sibling' THEN 'sibling' WHEN 'cousin' THEN 'cousin'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.parentesco_termo_por_papel(papel text, sexo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE papel
    WHEN 'parent' THEN CASE WHEN sexo='Masculino' THEN 'Pai' WHEN sexo='Feminino' THEN 'Mãe' ELSE 'Pai/Mãe' END
    WHEN 'child' THEN CASE WHEN sexo='Masculino' THEN 'Filho' WHEN sexo='Feminino' THEN 'Filha' ELSE 'Filho(a)' END
    WHEN 'grandparent' THEN CASE WHEN sexo='Masculino' THEN 'Avô' WHEN sexo='Feminino' THEN 'Avó' ELSE 'Avô/Avó' END
    WHEN 'grandchild' THEN CASE WHEN sexo='Masculino' THEN 'Neto' WHEN sexo='Feminino' THEN 'Neta' ELSE 'Neto(a)' END
    WHEN 'great_grandparent' THEN CASE WHEN sexo='Masculino' THEN 'Bisavô' WHEN sexo='Feminino' THEN 'Bisavó' ELSE 'Bisavô/Bisavó' END
    WHEN 'great_grandchild' THEN CASE WHEN sexo='Masculino' THEN 'Bisneto' WHEN sexo='Feminino' THEN 'Bisneta' ELSE 'Bisneto(a)' END
    WHEN 'uncle_aunt' THEN CASE WHEN sexo='Masculino' THEN 'Tio' WHEN sexo='Feminino' THEN 'Tia' ELSE 'Tio(a)' END
    WHEN 'nephew_niece' THEN CASE WHEN sexo='Masculino' THEN 'Sobrinho' WHEN sexo='Feminino' THEN 'Sobrinha' ELSE 'Sobrinho(a)' END
    WHEN 'sibling' THEN CASE WHEN sexo='Masculino' THEN 'Irmão' WHEN sexo='Feminino' THEN 'Irmã' ELSE 'Irmão/Irmã' END
    WHEN 'cousin' THEN CASE WHEN sexo='Masculino' THEN 'Primo' WHEN sexo='Feminino' THEN 'Prima' ELSE 'Primo(a)' END
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.parentesco_reciproco(termo text, sexo_origem text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.parentesco_termo_por_papel(public.parentesco_papel_oposto(public.parentesco_papel(termo)), sexo_origem);
$$;

CREATE OR REPLACE FUNCTION public.grau_do_parentesco(termo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN termo IN ('Pai','Mãe','Filho','Filha') THEN '1º grau'
    WHEN termo IN ('Irmão','Irmã','Avô','Avó','Neto','Neta') THEN '2º grau'
    WHEN termo IN ('Tio','Tia','Sobrinho','Sobrinha','Bisavô','Bisavó','Bisneto','Bisneta','Primo','Prima') THEN '3º grau'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_parentescos_reciprocos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  target_id uuid;
  termo_rec text;
  old_ids uuid[];
  new_ids uuid[];
  removed_ids uuid[];
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.parentescos IS NOT DISTINCT FROM OLD.parentescos THEN
    RETURN NEW;
  END IF;

  -- Cria ou atualiza o vínculo recíproco em cada parente que tem cadastro (paciente_id preenchido)
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(NEW.parentescos,'[]'::jsonb))
  LOOP
    target_id := nullif(item->>'paciente_id','')::uuid;
    IF target_id IS NOT NULL AND coalesce(item->>'parentesco','') <> '' THEN
      termo_rec := public.parentesco_reciproco(item->>'parentesco', NEW.sexo);
      IF termo_rec IS NOT NULL THEN
        UPDATE public.pacientes t
        SET parentescos = CASE
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(coalesce(t.parentescos,'[]'::jsonb)) x
            WHERE (x->>'paciente_id')::uuid = NEW.paciente_id
          )
          THEN (
            SELECT jsonb_agg(
              CASE WHEN (x->>'paciente_id')::uuid = NEW.paciente_id
                THEN jsonb_build_object('nome',NEW.name,'cpf',coalesce(NEW.cpf,''),'parentesco',termo_rec,'grau',coalesce(public.grau_do_parentesco(termo_rec),''),'paciente_id',NEW.paciente_id::text,'auto',true)
                ELSE x
              END
            )
            FROM jsonb_array_elements(coalesce(t.parentescos,'[]'::jsonb)) x
          )
          ELSE coalesce(t.parentescos,'[]'::jsonb) || jsonb_build_array(
            jsonb_build_object('nome',NEW.name,'cpf',coalesce(NEW.cpf,''),'parentesco',termo_rec,'grau',coalesce(public.grau_do_parentesco(termo_rec),''),'paciente_id',NEW.paciente_id::text,'auto',true)
          )
        END
        WHERE t.paciente_id = target_id AND t.user_id = NEW.user_id;
      END IF;
    END IF;
  END LOOP;

  -- Remove o vínculo recíproco (somente os criados automaticamente) quando o vínculo de origem for apagado
  SELECT array_agg((x->>'paciente_id')::uuid) INTO old_ids
    FROM jsonb_array_elements(coalesce(OLD.parentescos,'[]'::jsonb)) x
    WHERE coalesce(x->>'paciente_id','') <> '';
  SELECT array_agg((x->>'paciente_id')::uuid) INTO new_ids
    FROM jsonb_array_elements(coalesce(NEW.parentescos,'[]'::jsonb)) x
    WHERE coalesce(x->>'paciente_id','') <> '';

  SELECT array_agg(v) INTO removed_ids
  FROM unnest(coalesce(old_ids,'{}'::uuid[])) v
  WHERE v <> ALL(coalesce(new_ids,'{}'::uuid[]));

  IF removed_ids IS NOT NULL THEN
    UPDATE public.pacientes t
    SET parentescos = (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(t.parentescos,'[]'::jsonb)) x
      WHERE NOT ( (x->>'paciente_id')::uuid = NEW.paciente_id AND coalesce((x->>'auto')::boolean,false) )
    )
    WHERE t.paciente_id = ANY(removed_ids) AND t.user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_parentescos_reciprocos ON public.pacientes;
CREATE TRIGGER trg_sync_parentescos_reciprocos
AFTER UPDATE OF parentescos ON public.pacientes
FOR EACH ROW
EXECUTE FUNCTION public.sync_parentescos_reciprocos();
