-- 1) Elimina a distinção de sexo dos termos de parentesco: passam a existir só
--    termos genéricos (Pai/Mãe, Filho(a), Avô/Avó, Neto(a), Tio(a), Sobrinho(a),
--    Irmão/Irmã, Primo(a), Bisavô/Bisavó, Bisneto(a)). Os termos antigos
--    continuam reconhecidos aqui só por compatibilidade com dados já gravados.
-- 2) Adiciona o campo "consanguineo" (true por padrão) em cada item de
--    parentescos, para indicar se aquele parente deve entrar na análise
--    genética/histórico familiar de CIDs ou não (ex: pai/mãe por adoção).

CREATE OR REPLACE FUNCTION public.parentesco_papel(termo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE termo
    WHEN 'Pai/Mãe' THEN 'parent'
    WHEN 'Filho(a)' THEN 'child'
    WHEN 'Avô/Avó' THEN 'grandparent'
    WHEN 'Neto(a)' THEN 'grandchild'
    WHEN 'Bisavô/Bisavó' THEN 'great_grandparent'
    WHEN 'Bisneto(a)' THEN 'great_grandchild'
    WHEN 'Tio(a)' THEN 'uncle_aunt'
    WHEN 'Sobrinho(a)' THEN 'nephew_niece'
    WHEN 'Irmão/Irmã' THEN 'sibling'
    WHEN 'Primo(a)' THEN 'cousin'
    -- termos antigos (dados gravados antes desta migration)
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

DROP FUNCTION IF EXISTS public.parentesco_termo_por_papel(text, text);
CREATE OR REPLACE FUNCTION public.parentesco_termo_por_papel(papel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE papel
    WHEN 'parent' THEN 'Pai/Mãe'
    WHEN 'child' THEN 'Filho(a)'
    WHEN 'grandparent' THEN 'Avô/Avó'
    WHEN 'grandchild' THEN 'Neto(a)'
    WHEN 'great_grandparent' THEN 'Bisavô/Bisavó'
    WHEN 'great_grandchild' THEN 'Bisneto(a)'
    WHEN 'uncle_aunt' THEN 'Tio(a)'
    WHEN 'nephew_niece' THEN 'Sobrinho(a)'
    WHEN 'sibling' THEN 'Irmão/Irmã'
    WHEN 'cousin' THEN 'Primo(a)'
    ELSE NULL
  END;
$$;

DROP FUNCTION IF EXISTS public.parentesco_reciproco(text, text);
CREATE OR REPLACE FUNCTION public.parentesco_reciproco(termo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.parentesco_termo_por_papel(public.parentesco_papel_oposto(public.parentesco_papel(termo)));
$$;

CREATE OR REPLACE FUNCTION public.grau_do_parentesco(termo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN termo IN ('Pai/Mãe','Filho(a)','Pai','Mãe','Filho','Filha') THEN '1º grau'
    WHEN termo IN ('Irmão/Irmã','Avô/Avó','Neto(a)','Irmão','Irmã','Avô','Avó','Neto','Neta') THEN '2º grau'
    WHEN termo IN ('Tio(a)','Sobrinho(a)','Bisavô/Bisavó','Bisneto(a)','Primo(a)','Tio','Tia','Sobrinho','Sobrinha','Bisavô','Bisavó','Bisneto','Bisneta','Primo','Prima') THEN '3º grau'
    ELSE NULL
  END;
$$;

-- Recíproco automático: agora sem depender do sexo, e propagando o campo
-- "consanguineo" para o lado espelhado (se A marcou o vínculo com B como não
-- consanguíneo, o vínculo de B com A também nasce como não consanguíneo).
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
  consang boolean;
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

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(NEW.parentescos,'[]'::jsonb))
  LOOP
    target_id := nullif(item->>'paciente_id','')::uuid;
    IF target_id IS NOT NULL AND coalesce(item->>'parentesco','') <> '' THEN
      termo_rec := public.parentesco_reciproco(item->>'parentesco');
      consang := coalesce((item->>'consanguineo')::boolean, true);
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
                THEN jsonb_build_object('nome',NEW.name,'cpf',coalesce(NEW.cpf,''),'parentesco',termo_rec,'grau',coalesce(public.grau_do_parentesco(termo_rec),''),'paciente_id',NEW.paciente_id::text,'auto',true,'consanguineo',consang)
                ELSE x
              END
            )
            FROM jsonb_array_elements(coalesce(t.parentescos,'[]'::jsonb)) x
          )
          ELSE coalesce(t.parentescos,'[]'::jsonb) || jsonb_build_array(
            jsonb_build_object('nome',NEW.name,'cpf',coalesce(NEW.cpf,''),'parentesco',termo_rec,'grau',coalesce(public.grau_do_parentesco(termo_rec),''),'paciente_id',NEW.paciente_id::text,'auto',true,'consanguineo',consang)
          )
        END
        WHERE t.paciente_id = target_id AND t.user_id = NEW.user_id;
      END IF;
    END IF;
  END LOOP;

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

-- Sugestão por parente em comum: mesma lógica, agora com termo genérico.
CREATE OR REPLACE FUNCTION public.buscar_parentes_possiveis(p_paciente_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(paciente_id uuid, name text, cpf text, data_nascimento date, parentesco_sugerido text, motivo text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT p.paciente_id, p.user_id, p.name, p.parentescos
    FROM public.pacientes p
    WHERE p.paciente_id = p_paciente_id AND p.user_id = auth.uid()
  ),
  vinculados AS (
    SELECT (x->>'paciente_id')::uuid AS pid
    FROM base b, jsonb_array_elements(coalesce(b.parentescos,'[]'::jsonb)) x
    WHERE coalesce(x->>'paciente_id','') <> ''
  ),
  por_sobrenome AS (
    SELECT o.paciente_id, o.name, o.cpf, o.data_nascimento,
           NULL::text AS parentesco_sugerido,
           'Mesmo sobrenome: ' || public.sobrenome_paciente(o.name) AS motivo
    FROM base b
    JOIN public.pacientes o
      ON o.user_id = b.user_id
     AND o.paciente_id <> b.paciente_id
     AND public.sobrenome_paciente(o.name) IS NOT NULL
     AND public.sobrenome_paciente(o.name) = public.sobrenome_paciente(b.name)
    WHERE o.paciente_id NOT IN (SELECT pid FROM vinculados)
  ),
  por_parente_comum AS (
    SELECT DISTINCT ON (z.paciente_id)
      z.paciente_id, z.name, z.cpf, z.data_nascimento,
      public.parentesco_termo_por_papel(
        public.parentesco_papel_composto(
          public.parentesco_papel(xy->>'parentesco'),
          public.parentesco_papel(yz->>'parentesco')
        )
      ) AS parentesco_sugerido,
      'Parente em comum: ' || y.name AS motivo
    FROM base b
    JOIN LATERAL jsonb_array_elements(coalesce(b.parentescos,'[]'::jsonb)) xy
      ON coalesce(xy->>'paciente_id','') <> ''
    JOIN public.pacientes y ON y.paciente_id = (xy->>'paciente_id')::uuid AND y.user_id = b.user_id
    JOIN LATERAL jsonb_array_elements(coalesce(y.parentescos,'[]'::jsonb)) yz
      ON coalesce(yz->>'paciente_id','') <> ''
    JOIN public.pacientes z ON z.paciente_id = (yz->>'paciente_id')::uuid AND z.user_id = b.user_id
    WHERE z.paciente_id <> b.paciente_id
      AND z.paciente_id NOT IN (SELECT pid FROM vinculados)
      AND public.parentesco_papel_composto(
            public.parentesco_papel(xy->>'parentesco'),
            public.parentesco_papel(yz->>'parentesco')
          ) IS NOT NULL
    ORDER BY z.paciente_id, y.name
  ),
  combinado AS (
    SELECT * FROM por_parente_comum
    UNION ALL
    SELECT * FROM por_sobrenome
  )
  SELECT DISTINCT ON (paciente_id) paciente_id, name, cpf, data_nascimento, parentesco_sugerido, motivo
  FROM combinado
  ORDER BY paciente_id, parentesco_sugerido NULLS LAST, name
  LIMIT least(greatest(coalesce(p_limit,20),1),100);
$$;

-- Grafo familiar: agora as arestas também trazem "consanguineo".
CREATE OR REPLACE FUNCTION public.grafo_familiar(p_paciente_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH RECURSIVE alcancaveis AS (
    SELECT p_paciente_id AS paciente_id
    WHERE p_paciente_id IS NOT NULL
    UNION
    SELECT (x->>'paciente_id')::uuid
    FROM alcancaveis a
    JOIN public.pacientes p ON p.paciente_id = a.paciente_id AND p.user_id = auth.uid()
    CROSS JOIN jsonb_array_elements(coalesce(p.parentescos,'[]'::jsonb)) x
    WHERE coalesce(x->>'paciente_id','') <> ''
  ),
  nos AS (
    SELECT p.paciente_id, p.name, p.sexo, p.data_nascimento, coalesce(p.cids,'[]'::jsonb) AS cids
    FROM public.pacientes p
    WHERE p.user_id = auth.uid()
      AND (
        (p_paciente_id IS NOT NULL AND p.paciente_id IN (SELECT paciente_id FROM alcancaveis))
        OR (p_paciente_id IS NULL AND jsonb_array_length(coalesce(p.parentescos,'[]'::jsonb)) > 0)
      )
  ),
  arestas AS (
    SELECT DISTINCT ON (LEAST(p.paciente_id,(x->>'paciente_id')::uuid), GREATEST(p.paciente_id,(x->>'paciente_id')::uuid))
      p.paciente_id AS origem,
      (x->>'paciente_id')::uuid AS destino,
      nullif(x->>'parentesco','') AS parentesco,
      nullif(x->>'grau','') AS grau,
      coalesce((x->>'consanguineo')::boolean, true) AS consanguineo
    FROM public.pacientes p
    CROSS JOIN jsonb_array_elements(coalesce(p.parentescos,'[]'::jsonb)) x
    WHERE p.user_id = auth.uid()
      AND coalesce(x->>'paciente_id','') <> ''
      AND p.paciente_id IN (SELECT paciente_id FROM nos)
      AND (x->>'paciente_id')::uuid IN (SELECT paciente_id FROM nos)
    ORDER BY LEAST(p.paciente_id,(x->>'paciente_id')::uuid),
             GREATEST(p.paciente_id,(x->>'paciente_id')::uuid),
             (p.paciente_id <> LEAST(p.paciente_id,(x->>'paciente_id')::uuid))
  )
  SELECT jsonb_build_object(
    'nodes', coalesce((SELECT jsonb_agg(jsonb_build_object('id',paciente_id,'nome',name,'sexo',sexo,'nascimento',data_nascimento,'cids',cids)) FROM nos),'[]'::jsonb),
    'edges', coalesce((SELECT jsonb_agg(jsonb_build_object('origem',origem,'destino',destino,'parentesco',parentesco,'grau',grau,'consanguineo',consanguineo)) FROM arestas),'[]'::jsonb)
  );
$$;

-- Normaliza os dados já gravados: converte termos antigos (Pai, Mãe, Filho...)
-- para os termos genéricos novos, recalcula o grau, e garante que todo item
-- tenha o campo "consanguineo" (assume true quando não informado).
UPDATE public.pacientes p
SET parentescos = (
  SELECT jsonb_agg(
    x || jsonb_build_object(
      'parentesco', coalesce(public.parentesco_termo_por_papel(public.parentesco_papel(x->>'parentesco')), x->>'parentesco'),
      'grau', coalesce(
        public.grau_do_parentesco(coalesce(public.parentesco_termo_por_papel(public.parentesco_papel(x->>'parentesco')), x->>'parentesco')),
        x->>'grau'
      ),
      'consanguineo', coalesce((x->>'consanguineo')::boolean, true)
    )
  )
  FROM jsonb_array_elements(p.parentescos) x
)
WHERE p.parentescos IS NOT NULL AND jsonb_array_length(p.parentescos) > 0;
