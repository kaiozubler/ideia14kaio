-- 1. Conceitos clínicos (domínio reaproveitável entre protocolos)
CREATE TABLE public.conceitos_clinicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  codigo text NOT NULL,
  rotulo text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, codigo)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conceitos_clinicos TO authenticated;
GRANT ALL ON public.conceitos_clinicos TO service_role;
ALTER TABLE public.conceitos_clinicos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam seus conceitos" ON public.conceitos_clinicos
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_conceitos_clinicos_updated BEFORE UPDATE ON public.conceitos_clinicos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Apelidos de exames (aprendizado de correcao)
CREATE TABLE public.exame_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  texto_original text NOT NULL,
  tuss_procedimento_id uuid NOT NULL REFERENCES public.tuss_procedimentos(id),
  origem text NOT NULL DEFAULT 'correcao_medico' CHECK (origem IN ('correcao_medico','ia')),
  confianca numeric,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exame_alias_texto ON public.exame_alias (lower(texto_original));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exame_alias TO authenticated;
GRANT ALL ON public.exame_alias TO service_role;
ALTER TABLE public.exame_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam seus aliases" ON public.exame_alias
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. protocolo_acoes: vinculo com catalogo + ramificacao
ALTER TABLE public.protocolo_acoes
  ADD COLUMN tuss_procedimento_id uuid REFERENCES public.tuss_procedimentos(id),
  ADD COLUMN id_substancia uuid REFERENCES public.substancias(id_substancia),
  ADD COLUMN catalogo_status text NOT NULL DEFAULT 'nao_aplicavel'
    CHECK (catalogo_status IN ('vinculado','pendente_cadastro','nao_aplicavel')),
  ADD COLUMN regra_pai_id uuid;
CREATE INDEX idx_protocolo_acoes_tuss ON public.protocolo_acoes(tuss_procedimento_id);
CREATE INDEX idx_protocolo_acoes_regra_pai ON public.protocolo_acoes(regra_pai_id);

-- 4. protocolo_regras
CREATE TABLE public.protocolo_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  protocolo_id uuid NOT NULL REFERENCES public.protocolos(id) ON DELETE CASCADE,
  acao_gatilho_id uuid NOT NULL REFERENCES public.protocolo_acoes(id) ON DELETE CASCADE,
  descricao text,
  condicao jsonb,
  ordem integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  repete_gatilho_apos_dias integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_protocolo_regras_gatilho ON public.protocolo_regras(acao_gatilho_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocolo_regras TO authenticated;
GRANT ALL ON public.protocolo_regras TO service_role;
ALTER TABLE public.protocolo_regras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam suas regras" ON public.protocolo_regras
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_protocolo_regras_updated BEFORE UPDATE ON public.protocolo_regras
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.protocolo_acoes
  ADD CONSTRAINT protocolo_acoes_regra_pai_fkey
  FOREIGN KEY (regra_pai_id) REFERENCES public.protocolo_regras(id) ON DELETE CASCADE;

-- 5. protocolo_tarefas: resultado
ALTER TABLE public.protocolo_tarefas
  ADD COLUMN resultado_valor jsonb,
  ADD COLUMN resultado_registrado_em timestamptz,
  ADD COLUMN regra_origem_id uuid REFERENCES public.protocolo_regras(id) ON DELETE SET NULL;

-- 6. exames
ALTER TABLE public.exames
  ADD COLUMN tuss_procedimento_id uuid REFERENCES public.tuss_procedimentos(id),
  ADD COLUMN status_tuss text NOT NULL DEFAULT 'nao_aplicavel'
    CHECK (status_tuss IN ('vinculado','nao_localizado','nao_aplicavel')),
  ADD COLUMN resultado_original text,
  ADD COLUMN resultado_estruturado jsonb,
  ADD COLUMN protocolo_tarefa_id uuid REFERENCES public.protocolo_tarefas(id) ON DELETE SET NULL,
  ADD COLUMN status_protocolo text NOT NULL DEFAULT 'sem_protocolo'
    CHECK (status_protocolo IN ('sem_protocolo','sem_regra','regra_nao_atingida',
      'regra_atingida','aguardando_interpretacao','erro_interpretacao'));
CREATE INDEX idx_exames_tuss ON public.exames(tuss_procedimento_id);
CREATE INDEX idx_exames_protocolo_tarefa ON public.exames(protocolo_tarefa_id);

-- 7. buscar_tuss com prioridade para alias do medico
CREATE OR REPLACE FUNCTION public.buscar_tuss(
  termo text,
  p_tabela text DEFAULT 'tuss-22',
  p_limit integer DEFAULT 30,
  p_usar_alias boolean DEFAULT false,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, codigo_tuss text, nome text, descricao text, grupo text, subgrupo text, classe text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT nullif(trim(coalesce(termo,'')), '') AS q),
  alias_hit AS (
    SELECT p.id, p.codigo_tuss, p.nome, p.descricao, p.grupo, p.subgrupo, p.classe
    FROM public.exame_alias a
    JOIN public.tuss_procedimentos p ON p.id = a.tuss_procedimento_id
    CROSS JOIN t
    WHERE p_usar_alias
      AND a.ativo
      AND t.q IS NOT NULL
      AND (p_user_id IS NULL OR a.user_id = p_user_id)
      AND lower(public.unaccent(a.texto_original)) = lower(public.unaccent(t.q))
    LIMIT 1
  ),
  fuzzy AS (
    SELECT p.id, p.codigo_tuss, p.nome, p.descricao, p.grupo, p.subgrupo, p.classe
    FROM public.tuss_procedimentos p, t
    WHERE NOT EXISTS (SELECT 1 FROM alias_hit)
      AND p.tabela = coalesce(p_tabela, p.tabela)
      AND p.grupo IS DISTINCT FROM 'Odontologia'
      AND (
        t.q IS NULL
        OR p.codigo_tuss LIKE t.q || '%'
        OR lower(public.unaccent(p.nome)) LIKE '%' || lower(public.unaccent(t.q)) || '%'
        OR lower(public.unaccent(coalesce(p.descricao,''))) LIKE '%' || lower(public.unaccent(t.q)) || '%'
      )
    ORDER BY
      (t.q IS NOT NULL AND p.codigo_tuss = t.q) DESC,
      similarity(lower(public.unaccent(p.nome)), lower(public.unaccent(coalesce(t.q,'')))) DESC,
      p.nome
    LIMIT least(greatest(coalesce(p_limit, 30), 1), 200)
  )
  SELECT * FROM alias_hit
  UNION ALL
  SELECT * FROM fuzzy;
$function$;

-- 8. avaliar_condicao
CREATE OR REPLACE FUNCTION public.avaliar_condicao(p_condicao jsonb, p_resultado jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_campo text;
  v_op text;
  v_num numeric;
BEGIN
  IF p_condicao IS NULL OR p_resultado IS NULL THEN RETURN false; END IF;
  v_campo := p_condicao->>'campo';
  v_op := p_condicao->>'operador';

  IF v_campo = 'numero' THEN
    IF p_resultado->>'numero' IS NULL THEN RETURN false; END IF;
    BEGIN
      v_num := (p_resultado->>'numero')::numeric;
    EXCEPTION WHEN others THEN RETURN false; END;
    RETURN CASE v_op
      WHEN 'maior_que' THEN v_num > (p_condicao->>'numero')::numeric
      WHEN 'menor_que' THEN v_num < (p_condicao->>'numero')::numeric
      WHEN 'igual' THEN v_num = (p_condicao->>'numero')::numeric
      WHEN 'entre' THEN v_num >= (p_condicao->>'numero_min')::numeric
                    AND v_num <= (p_condicao->>'numero_max')::numeric
      ELSE false END;

  ELSIF v_campo = 'texto' THEN
    IF p_resultado->>'texto' IS NULL THEN RETURN false; END IF;
    RETURN CASE v_op
      WHEN 'igual' THEN lower(public.unaccent(p_resultado->>'texto')) = lower(public.unaccent(coalesce(p_condicao->>'texto','')))
      WHEN 'contem' THEN lower(public.unaccent(p_resultado->>'texto')) LIKE '%' || lower(public.unaccent(coalesce(p_condicao->>'texto',''))) || '%'
      ELSE false END;

  ELSIF v_campo = 'achado' THEN
    IF p_resultado->'achados' IS NULL THEN RETURN false; END IF;
    RETURN COALESCE((p_resultado->'achados'->>(p_condicao->>'conceito'))::boolean, false)
      = COALESCE((p_condicao->>'presente')::boolean, true);
  END IF;

  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.avaliar_condicao(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_condicao(jsonb, jsonb) TO authenticated, service_role;

-- 9. gerar_tarefas_protocolo: nao instanciar acoes de ramo (regra_pai_id)
CREATE OR REPLACE FUNCTION public.gerar_tarefas_protocolo(p_vinculo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v record;
  a record;
  d integer;
  occ integer;
  horizon integer := 730;
BEGIN
  SELECT * INTO v FROM public.paciente_protocolos WHERE id = p_vinculo_id;
  IF NOT FOUND OR v.ativo = false THEN RETURN; END IF;

  FOR a IN SELECT * FROM public.protocolo_acoes
           WHERE protocolo_id = v.protocolo_id AND regra_pai_id IS NULL LOOP
    occ := 0;
    d := a.start_day;
    LOOP
      INSERT INTO public.protocolo_tarefas
        (user_id, paciente_protocolo_id, acao_id, paciente_id, protocolo_id, ocorrencia, due_date)
      VALUES
        (v.user_id, v.id, a.id, v.paciente_id, v.protocolo_id, occ, v.iniciado_em + d)
      ON CONFLICT (paciente_protocolo_id, acao_id, ocorrencia) DO NOTHING;

      EXIT WHEN NOT a.recurrent OR a.frequency <= 0;
      occ := occ + 1;
      d := d + a.frequency;
      EXIT WHEN d > horizon OR occ > 60;
    END LOOP;
  END LOOP;
END;
$function$;

-- 10. avaliar_resultado_tarefa
CREATE OR REPLACE FUNCTION public.avaliar_resultado_tarefa(p_tarefa_id uuid, p_resultado jsonb)
RETURNS TABLE(status text, regra_id uuid, tarefas_criadas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  t record;
  r record;
  a record;
  v_regra uuid := NULL;
  v_repete integer := NULL;
  v_criadas integer := 0;
  v_occ integer;
BEGIN
  SELECT * INTO t FROM public.protocolo_tarefas WHERE id = p_tarefa_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'erro_interpretacao', NULL::uuid, 0; RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> t.user_id THEN
    RAISE EXCEPTION 'Tarefa nao pertence ao usuario atual' USING ERRCODE = '42501';
  END IF;

  UPDATE public.protocolo_tarefas
  SET resultado_valor = p_resultado,
      resultado_registrado_em = now(),
      status = 'concluido'
  WHERE id = p_tarefa_id;

  FOR r IN
    SELECT * FROM public.protocolo_regras
    WHERE acao_gatilho_id = t.acao_id
    ORDER BY is_default, ordem
  LOOP
    IF r.is_default OR public.avaliar_condicao(r.condicao, p_resultado) THEN
      v_regra := r.id;
      v_repete := r.repete_gatilho_apos_dias;
      EXIT;
    END IF;
  END LOOP;

  IF v_regra IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.protocolo_regras WHERE acao_gatilho_id = t.acao_id) THEN
      RETURN QUERY SELECT 'regra_nao_atingida', NULL::uuid, 0;
    ELSE
      RETURN QUERY SELECT 'sem_regra', NULL::uuid, 0;
    END IF;
    RETURN;
  END IF;

  FOR a IN SELECT * FROM public.protocolo_acoes WHERE regra_pai_id = v_regra LOOP
    SELECT COALESCE(MAX(ocorrencia) + 1, 0) INTO v_occ
    FROM public.protocolo_tarefas
    WHERE paciente_protocolo_id = t.paciente_protocolo_id AND acao_id = a.id;

    INSERT INTO public.protocolo_tarefas
      (user_id, paciente_protocolo_id, acao_id, paciente_id, protocolo_id, ocorrencia, due_date, regra_origem_id)
    VALUES
      (t.user_id, t.paciente_protocolo_id, a.id, t.paciente_id, t.protocolo_id, v_occ,
       current_date + COALESCE(a.start_day, 0), v_regra)
    ON CONFLICT (paciente_protocolo_id, acao_id, ocorrencia) DO NOTHING;
    v_criadas := v_criadas + 1;
  END LOOP;

  IF v_repete IS NOT NULL AND v_repete > 0 THEN
    SELECT COALESCE(MAX(ocorrencia) + 1, 0) INTO v_occ
    FROM public.protocolo_tarefas
    WHERE paciente_protocolo_id = t.paciente_protocolo_id AND acao_id = t.acao_id;

    INSERT INTO public.protocolo_tarefas
      (user_id, paciente_protocolo_id, acao_id, paciente_id, protocolo_id, ocorrencia, due_date, regra_origem_id)
    VALUES
      (t.user_id, t.paciente_protocolo_id, t.acao_id, t.paciente_id, t.protocolo_id, v_occ,
       current_date + v_repete, v_regra)
    ON CONFLICT (paciente_protocolo_id, acao_id, ocorrencia) DO NOTHING;
    v_criadas := v_criadas + 1;
  END IF;

  RETURN QUERY SELECT 'regra_atingida', v_regra, v_criadas;
END;
$fn$;
REVOKE ALL ON FUNCTION public.avaliar_resultado_tarefa(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_resultado_tarefa(uuid, jsonb) TO authenticated, service_role;

-- 11. avaliar_resultado_exame (exame avulso) -- cobre multiplos protocolos ativos
CREATE OR REPLACE FUNCTION public.avaliar_resultado_exame(
  p_exame_id uuid,
  p_paciente_id uuid,
  p_tuss_procedimento_id uuid,
  p_resultado jsonb
)
RETURNS TABLE(status_protocolo text, protocolo_id uuid, protocolo_titulo text, regra_id uuid, tarefa_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_owner uuid;
  acao record;
  tarefa_pendente record;
  aval record;
  v_status text;
  v_tarefa uuid;
  v_regra uuid;
  v_algum boolean := false;
BEGIN
  IF p_tuss_procedimento_id IS NULL OR p_paciente_id IS NULL THEN
    RETURN QUERY SELECT 'sem_protocolo', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  SELECT user_id INTO v_owner FROM public.pacientes WHERE paciente_id = p_paciente_id;
  IF v_owner IS NULL THEN
    RETURN QUERY SELECT 'sem_protocolo', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_owner THEN
    RAISE EXCEPTION 'Paciente nao pertence ao usuario atual' USING ERRCODE = '42501';
  END IF;

  FOR acao IN
    SELECT a.id, a.protocolo_id, a.start_day, pp.id AS vinculo_id, pr.titulo
    FROM public.protocolo_acoes a
    JOIN public.paciente_protocolos pp ON pp.protocolo_id = a.protocolo_id
    JOIN public.protocolos pr ON pr.id = a.protocolo_id
    WHERE a.tuss_procedimento_id = p_tuss_procedimento_id
      AND pp.paciente_id = p_paciente_id
      AND pp.ativo = true
  LOOP
    v_algum := true;
    v_status := 'sem_regra';
    v_regra := NULL;
    v_tarefa := NULL;

    SELECT t.* INTO tarefa_pendente
    FROM public.protocolo_tarefas t
    WHERE t.paciente_protocolo_id = acao.vinculo_id
      AND t.acao_id = acao.id
      AND t.status IN ('nao_avisado','avisado')
    ORDER BY t.due_date
    LIMIT 1;

    IF FOUND THEN
      v_tarefa := tarefa_pendente.id;
      SELECT * INTO aval FROM public.avaliar_resultado_tarefa(tarefa_pendente.id, p_resultado);
      v_status := aval.status;
      v_regra := aval.regra_id;
      UPDATE public.exames SET protocolo_tarefa_id = tarefa_pendente.id WHERE id = p_exame_id;
    ELSIF EXISTS (SELECT 1 FROM public.protocolo_regras r WHERE r.acao_gatilho_id = acao.id) THEN
      v_status := 'aguardando_interpretacao';
    END IF;

    RETURN QUERY SELECT v_status, acao.protocolo_id, acao.titulo, v_regra, v_tarefa;
  END LOOP;

  IF NOT v_algum THEN
    RETURN QUERY SELECT 'sem_protocolo', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.avaliar_resultado_exame(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_resultado_exame(uuid, uuid, uuid, jsonb) TO authenticated, service_role;