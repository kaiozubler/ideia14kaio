-- Protocolos a partir de PCDTs: variações medicamentosas, critérios por
-- paciente, ações de Alerta e salvamento atômico que preserva o histórico.
--
-- Aditivo: protocolos já salvos continuam funcionando igual (detalhes = '{}',
-- criterio_paciente = NULL => a ação vale para todos os pacientes).

-- 1. Campos novos ------------------------------------------------------------

-- detalhes (por tipo de ação):
--   Receita: { "linha_tratamento": 1, "grupo_alternativa": "IECA",
--              "esquemas": [ { "populacao": "Adulto", "dose": "10 mg", "via": "oral",
--                              "posologia": "1x/dia", "duracao": "contínuo",
--                              "dose_maxima": "40 mg/dia" } ],
--              "criterios_inclusao": [...], "criterios_exclusao": [...],
--              "contraindicacoes": [...], "ajuste_renal_hepatico": "...",
--              "monitorizacao": "...", "ceaf": true }
--   Alerta:  { "nivel": "info"|"atencao"|"critico",
--              "conduta": "suspender"|"ajustar"|"encaminhar"|"notificar"|"reavaliar",
--              "mensagem": "...", "medicamento_alvo": "Metotrexato" }
ALTER TABLE public.protocolo_acoes
  ADD COLUMN IF NOT EXISTS detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { "idade_min": 18, "idade_max": null, "sexo": "F" } — NULL = todos os pacientes
  ADD COLUMN IF NOT EXISTS criterio_paciente jsonb;

-- Regra que dispara as MESMAS ações de outra regra. Usado quando um ramo diz
-- "exame A alterado OU exame B alterado": cada exame ganha sua regra, mas as
-- ações do ramo existem uma vez só (antes seriam copiadas por exame).
ALTER TABLE public.protocolo_regras
  ADD COLUMN IF NOT EXISTS compartilha_acoes_de uuid REFERENCES public.protocolo_regras(id) ON DELETE CASCADE;

-- Fonte do protocolo (PCDT/portaria/ano/arquivo) para rastreabilidade.
ALTER TABLE public.protocolos
  ADD COLUMN IF NOT EXISTS fonte jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Critério de paciente ------------------------------------------------------
-- Dado ausente (sem data de nascimento/sexo) não exclui o paciente: é melhor
-- gerar uma tarefa a mais do que deixar de acompanhar alguém.
CREATE OR REPLACE FUNCTION public.paciente_atende_criterio(p_paciente_id uuid, p_criterio jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_nasc date;
  v_sexo text;
  v_idade integer;
BEGIN
  IF p_criterio IS NULL OR p_criterio = '{}'::jsonb OR jsonb_typeof(p_criterio) <> 'object' THEN
    RETURN true;
  END IF;

  SELECT data_nascimento, upper(left(trim(coalesce(sexo, '')), 1))
    INTO v_nasc, v_sexo
  FROM public.pacientes WHERE paciente_id = p_paciente_id;

  IF v_nasc IS NOT NULL THEN
    v_idade := EXTRACT(YEAR FROM age(v_nasc))::int;
    IF nullif(p_criterio->>'idade_min', '') IS NOT NULL
       AND v_idade < (p_criterio->>'idade_min')::numeric THEN RETURN false; END IF;
    IF nullif(p_criterio->>'idade_max', '') IS NOT NULL
       AND v_idade > (p_criterio->>'idade_max')::numeric THEN RETURN false; END IF;
  END IF;

  IF nullif(p_criterio->>'sexo', '') IS NOT NULL AND v_sexo IN ('F', 'M')
     AND v_sexo <> upper(left(p_criterio->>'sexo', 1)) THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION WHEN others THEN
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.paciente_atende_criterio(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paciente_atende_criterio(uuid, jsonb) TO authenticated, service_role;

-- 3. avaliar_condicao: limites inclusivos (≥ / ≤) e "fora da faixa" ----------
-- PCDTs costumam escrever "≥ 7%" ou "TGO > 3x LSN"; sem maior_ou_igual a IA
-- precisava aproximar o limite (ex.: > 179 para ≥ 180), o que quebra decimais.
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
    RETURN COALESCE(CASE v_op
      WHEN 'maior_que' THEN v_num > (p_condicao->>'numero')::numeric
      WHEN 'menor_que' THEN v_num < (p_condicao->>'numero')::numeric
      WHEN 'maior_ou_igual' THEN v_num >= (p_condicao->>'numero')::numeric
      WHEN 'menor_ou_igual' THEN v_num <= (p_condicao->>'numero')::numeric
      WHEN 'igual' THEN v_num = (p_condicao->>'numero')::numeric
      WHEN 'entre' THEN v_num >= (p_condicao->>'numero_min')::numeric
                    AND v_num <= (p_condicao->>'numero_max')::numeric
      WHEN 'fora_de' THEN v_num < (p_condicao->>'numero_min')::numeric
                     OR v_num > (p_condicao->>'numero_max')::numeric
      ELSE false END, false);

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
EXCEPTION WHEN others THEN
  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.avaliar_condicao(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_condicao(jsonb, jsonb) TO authenticated, service_role;

-- 4. gerar_tarefas_protocolo: respeita criterio_paciente ---------------------
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
    CONTINUE WHEN NOT public.paciente_atende_criterio(v.paciente_id, a.criterio_paciente);
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
REVOKE EXECUTE ON FUNCTION public.gerar_tarefas_protocolo(uuid) FROM PUBLIC, anon, authenticated;

-- 5. avaliar_resultado_tarefa: ramos respeitam criterio_paciente -------------
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
  v_d integer;
  v_n integer;
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

  FOR a IN SELECT * FROM public.protocolo_acoes
           WHERE regra_pai_id = COALESCE(
             (SELECT compartilha_acoes_de FROM public.protocolo_regras WHERE id = v_regra), v_regra) LOOP
    CONTINUE WHEN NOT public.paciente_atende_criterio(t.paciente_id, a.criterio_paciente);

    -- Ação de ramo que ainda tem tarefa em aberto (ex.: 2ª linha já iniciada,
    -- alerta ainda não resolvido): não duplica a cada novo resultado que bate
    -- a regra, nem quando dois exames de um "OU" batem.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.protocolo_tarefas x
      WHERE x.paciente_protocolo_id = t.paciente_protocolo_id AND x.acao_id = a.id
        AND x.status IN ('nao_avisado','avisado','agendado'));

    SELECT COALESCE(MAX(ocorrencia) + 1, 0) INTO v_occ
    FROM public.protocolo_tarefas
    WHERE paciente_protocolo_id = t.paciente_protocolo_id AND acao_id = a.id;

    -- Antes só a 1ª ocorrência era criada, mesmo para medicamento de uso
    -- contínuo; agora a série segue a frequência, no mesmo horizonte de
    -- gerar_tarefas_protocolo (730 dias / 60 ocorrências).
    v_d := COALESCE(a.start_day, 0);
    v_n := 0;
    LOOP
      INSERT INTO public.protocolo_tarefas
        (user_id, paciente_protocolo_id, acao_id, paciente_id, protocolo_id, ocorrencia, due_date, regra_origem_id)
      VALUES
        (t.user_id, t.paciente_protocolo_id, a.id, t.paciente_id, t.protocolo_id, v_occ + v_n,
         current_date + v_d, v_regra)
      ON CONFLICT (paciente_protocolo_id, acao_id, ocorrencia) DO NOTHING;
      v_criadas := v_criadas + 1;
      EXIT WHEN NOT a.recurrent OR a.frequency <= 0;
      v_n := v_n + 1;
      v_d := v_d + a.frequency;
      EXIT WHEN v_d > 730 OR v_n > 60;
    END LOOP;
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
REVOKE EXECUTE ON FUNCTION public.avaliar_resultado_tarefa(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avaliar_resultado_tarefa(uuid, jsonb) TO service_role;

-- 6. avaliar_resultado_exame: grava exames.status_protocolo ------------------
-- Antes só gravava protocolo_tarefa_id; o selo "Regra atingida" da lista de
-- exames sumia ao recarregar porque status_protocolo ficava 'sem_protocolo'.
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
  v_final text := 'sem_protocolo';
  v_rank integer := 0;
  v_r integer;
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
      AND t.status IN ('nao_avisado','avisado','agendado')
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

    v_r := CASE v_status
      WHEN 'regra_atingida' THEN 5 WHEN 'aguardando_interpretacao' THEN 4
      WHEN 'regra_nao_atingida' THEN 3 WHEN 'sem_regra' THEN 2 ELSE 1 END;
    IF v_r > v_rank THEN v_rank := v_r; v_final := v_status; END IF;

    RETURN QUERY SELECT v_status, acao.protocolo_id, acao.titulo, v_regra, v_tarefa;
  END LOOP;

  UPDATE public.exames SET status_protocolo = v_final WHERE id = p_exame_id;

  IF NOT v_algum THEN
    RETURN QUERY SELECT 'sem_protocolo', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid;
  END IF;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.avaliar_resultado_exame(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avaliar_resultado_exame(uuid, uuid, uuid, jsonb) TO service_role;

-- 7. salvar_protocolo: gravação atômica preservando ids ----------------------
-- O salvamento antigo (cliente) apagava TODAS as ações e regravava. Como
-- protocolo_tarefas.acao_id é ON DELETE CASCADE, qualquer edição apagava o
-- histórico dos pacientes (tarefas avisadas/concluídas e resultados) e
-- regerava tudo como "não avisado". Também não suportava ramo dentro de ramo
-- (regra cujo gatilho é uma ação de ramo), comum em PCDTs.
--
-- Agora: ids que já existem são atualizados no lugar, só o que saiu do
-- payload é removido, e tudo roda numa transação. Ids novos podem ser
-- qualquer string local (ex.: "n3k2j1") — referências entre ações e regras
-- usam esses ids e são resolvidas aqui, em quantos níveis forem necessários.
--
-- SECURITY INVOKER: a RLS de cada tabela garante que o médico só grava nos
-- próprios protocolos.
-- Retorna { "id": uuid, "acoes": { id_do_payload: uuid }, "regras": {...} }
-- para quem publica (ex.: Studio) lembrar o uuid de cada nó e, ao republicar,
-- mandar os mesmos ids — é isso que preserva o histórico dos pacientes.
DROP FUNCTION IF EXISTS public.salvar_protocolo(jsonb);
CREATE FUNCTION public.salvar_protocolo(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_titulo text := nullif(trim(coalesce(p_payload->>'titulo', '')), '');
  v_acoes jsonb := coalesce(p_payload->'acoes', '[]'::jsonb);
  v_regras jsonb := coalesce(p_payload->'regras', '[]'::jsonb);
  v_old_acoes uuid[];
  v_old_regras uuid[];
  v_keep_acoes uuid[];
  v_keep_regras uuid[];
  v_amap jsonb := '{}'::jsonb; -- id do payload -> uuid real (ações)
  v_rmap jsonb := '{}'::jsonb; -- id do payload -> uuid real (regras)
  v_progress boolean;
  v_pass integer := 0;
  x jsonb;
  v_key text;
  v_pai text;
  v_pai_id uuid;
  v_gat uuid;
  v_comp text;
  v_new uuid;
  v_old record;
  v_uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao requerida' USING ERRCODE = '42501';
  END IF;
  IF v_titulo IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do protocolo' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_payload->>'id', '') ~ v_uuid_re THEN
    v_id := (p_payload->>'id')::uuid;
    UPDATE public.protocolos
       SET titulo = v_titulo,
           fonte = coalesce(p_payload->'fonte', fonte)
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Protocolo nao encontrado' USING ERRCODE = '42501';
    END IF;
  ELSE
    INSERT INTO public.protocolos (titulo, fonte)
    VALUES (v_titulo, coalesce(p_payload->'fonte', '{}'::jsonb))
    RETURNING id INTO v_id;
  END IF;

  -- CIDs (sem dependentes: pode substituir)
  DELETE FROM public.protocolo_cids WHERE protocolo_id = v_id;
  INSERT INTO public.protocolo_cids (protocolo_id, cid_code)
  SELECT DISTINCT v_id, upper(trim(c))
  FROM jsonb_array_elements_text(coalesce(p_payload->'cids', '[]'::jsonb)) c
  WHERE trim(c) <> '';

  SELECT coalesce(array_agg(id), '{}') INTO v_old_acoes FROM public.protocolo_acoes WHERE protocolo_id = v_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_old_regras FROM public.protocolo_regras WHERE protocolo_id = v_id;

  SELECT coalesce(array_agg((e->>'id')::uuid), '{}') INTO v_keep_acoes
  FROM jsonb_array_elements(v_acoes) e
  WHERE coalesce(e->>'id', '') ~ v_uuid_re AND (e->>'id')::uuid = ANY(v_old_acoes);
  SELECT coalesce(array_agg((e->>'id')::uuid), '{}') INTO v_keep_regras
  FROM jsonb_array_elements(v_regras) e
  WHERE coalesce(e->>'id', '') ~ v_uuid_re AND (e->>'id')::uuid = ANY(v_old_regras);

  -- Solta o vínculo de ramo das ações mantidas antes de apagar regras, para
  -- que o CASCADE de uma regra removida não leve junto uma ação que só mudou
  -- de ramo. O vínculo correto é regravado logo abaixo.
  UPDATE public.protocolo_acoes SET regra_pai_id = NULL
   WHERE protocolo_id = v_id AND id = ANY(v_keep_acoes) AND regra_pai_id IS NOT NULL;
  UPDATE public.protocolo_regras SET compartilha_acoes_de = NULL
   WHERE protocolo_id = v_id AND id = ANY(v_keep_regras) AND compartilha_acoes_de IS NOT NULL;
  DELETE FROM public.protocolo_regras WHERE protocolo_id = v_id AND NOT (id = ANY(v_keep_regras));
  DELETE FROM public.protocolo_acoes WHERE protocolo_id = v_id AND NOT (id = ANY(v_keep_acoes));

  -- Resolve ações e regras em camadas: ação raiz -> regra do gatilho ->
  -- ação de ramo -> regra dessa ação de ramo -> ...
  LOOP
    v_pass := v_pass + 1;
    v_progress := false;

    FOR x IN SELECT * FROM jsonb_array_elements(v_acoes) LOOP
      v_key := coalesce(x->>'id', '');
      CONTINUE WHEN v_key = '' OR v_amap ? v_key;
      v_pai := nullif(coalesce(x->>'regra_pai_id', ''), '');
      IF v_pai IS NOT NULL AND NOT (v_rmap ? v_pai) THEN CONTINUE; END IF;
      v_pai_id := CASE WHEN v_pai IS NULL THEN NULL ELSE (v_rmap->>v_pai)::uuid END;

      IF v_key ~ v_uuid_re AND v_key::uuid = ANY(v_keep_acoes) THEN
        SELECT start_day, frequency, recurrent, criterio_paciente
          INTO v_old FROM public.protocolo_acoes WHERE id = v_key::uuid;

        UPDATE public.protocolo_acoes SET
          tipo = coalesce(nullif(x->>'tipo', ''), 'Exame'),
          nome = coalesce(nullif(trim(x->>'nome'), ''), nome),
          start_day = coalesce((x->>'start_day')::int, 0),
          frequency = coalesce((x->>'frequency')::int, 90),
          recurrent = coalesce((x->>'recurrent')::boolean, true),
          auto_restart = coalesce((x->>'auto_restart')::boolean, false),
          especialidade = nullif(x->>'especialidade', ''),
          descricao = nullif(x->>'descricao', ''),
          tuss_procedimento_id = nullif(x->>'tuss_procedimento_id', '')::uuid,
          id_substancia = nullif(x->>'id_substancia', '')::uuid,
          catalogo_status = coalesce(nullif(x->>'catalogo_status', ''), 'nao_aplicavel'),
          detalhes = coalesce(x->'detalhes', '{}'::jsonb),
          criterio_paciente = CASE WHEN jsonb_typeof(x->'criterio_paciente') = 'object' THEN x->'criterio_paciente' END,
          regra_pai_id = v_pai_id
        WHERE id = v_key::uuid;

        -- Agenda mudou: descarta só as tarefas FUTURAS ainda não tratadas;
        -- sincronizar_protocolo as recria com o novo intervalo. Passado,
        -- avisos e resultados ficam intactos.
        IF v_old.start_day IS DISTINCT FROM coalesce((x->>'start_day')::int, 0)
           OR v_old.frequency IS DISTINCT FROM coalesce((x->>'frequency')::int, 90)
           OR v_old.recurrent IS DISTINCT FROM coalesce((x->>'recurrent')::boolean, true)
           OR v_old.criterio_paciente IS DISTINCT FROM
              (CASE WHEN jsonb_typeof(x->'criterio_paciente') = 'object' THEN x->'criterio_paciente' END)
        THEN
          DELETE FROM public.protocolo_tarefas
           WHERE acao_id = v_key::uuid
             AND status = 'nao_avisado'
             AND resultado_valor IS NULL
             AND due_date >= current_date;
        END IF;
        v_new := v_key::uuid;
      ELSE
        INSERT INTO public.protocolo_acoes
          (protocolo_id, tipo, nome, start_day, frequency, recurrent, auto_restart, especialidade,
           descricao, tuss_procedimento_id, id_substancia, catalogo_status, detalhes, criterio_paciente, regra_pai_id)
        VALUES (
          v_id,
          coalesce(nullif(x->>'tipo', ''), 'Exame'),
          coalesce(nullif(trim(x->>'nome'), ''), 'Ação sem nome'),
          coalesce((x->>'start_day')::int, 0),
          coalesce((x->>'frequency')::int, 90),
          coalesce((x->>'recurrent')::boolean, true),
          coalesce((x->>'auto_restart')::boolean, false),
          nullif(x->>'especialidade', ''),
          nullif(x->>'descricao', ''),
          nullif(x->>'tuss_procedimento_id', '')::uuid,
          nullif(x->>'id_substancia', '')::uuid,
          coalesce(nullif(x->>'catalogo_status', ''), 'nao_aplicavel'),
          coalesce(x->'detalhes', '{}'::jsonb),
          CASE WHEN jsonb_typeof(x->'criterio_paciente') = 'object' THEN x->'criterio_paciente' END,
          v_pai_id
        ) RETURNING id INTO v_new;
      END IF;

      v_amap := v_amap || jsonb_build_object(v_key, v_new);
      v_progress := true;
    END LOOP;

    FOR x IN SELECT * FROM jsonb_array_elements(v_regras) LOOP
      v_key := coalesce(x->>'id', '');
      CONTINUE WHEN v_key = '' OR v_rmap ? v_key;
      CONTINUE WHEN NOT (v_amap ? coalesce(x->>'acao_gatilho_id', ''));
      v_comp := nullif(coalesce(x->>'compartilha_acoes_de', ''), '');
      CONTINUE WHEN v_comp IS NOT NULL AND NOT (v_rmap ? v_comp);
      v_gat := (v_amap->>(x->>'acao_gatilho_id'))::uuid;

      IF v_key ~ v_uuid_re AND v_key::uuid = ANY(v_keep_regras) THEN
        UPDATE public.protocolo_regras SET
          acao_gatilho_id = v_gat,
          descricao = coalesce(x->>'descricao', ''),
          condicao = CASE WHEN coalesce((x->>'is_default')::boolean, false) THEN NULL ELSE x->'condicao' END,
          ordem = coalesce((x->>'ordem')::int, 0),
          is_default = coalesce((x->>'is_default')::boolean, false),
          repete_gatilho_apos_dias = nullif(x->>'repete_gatilho_apos_dias', '')::int,
          compartilha_acoes_de = CASE WHEN v_comp IS NULL THEN NULL ELSE (v_rmap->>v_comp)::uuid END
        WHERE id = v_key::uuid;
        v_new := v_key::uuid;
      ELSE
        INSERT INTO public.protocolo_regras
          (protocolo_id, acao_gatilho_id, descricao, condicao, ordem, is_default, repete_gatilho_apos_dias, compartilha_acoes_de)
        VALUES (
          v_id, v_gat, coalesce(x->>'descricao', ''),
          CASE WHEN coalesce((x->>'is_default')::boolean, false) THEN NULL ELSE x->'condicao' END,
          coalesce((x->>'ordem')::int, 0),
          coalesce((x->>'is_default')::boolean, false),
          nullif(x->>'repete_gatilho_apos_dias', '')::int,
          CASE WHEN v_comp IS NULL THEN NULL ELSE (v_rmap->>v_comp)::uuid END
        ) RETURNING id INTO v_new;
      END IF;

      v_rmap := v_rmap || jsonb_build_object(v_key, v_new);
      v_progress := true;
    END LOOP;

    EXIT WHEN NOT v_progress OR v_pass > 50;
  END LOOP;

  -- Algo ficou sem resolver = referência quebrada (ação de ramo apontando
  -- para regra inexistente, ou regra sem gatilho). Aborta tudo em vez de
  -- salvar um protocolo pela metade.
  SELECT e->>'nome' INTO v_key FROM jsonb_array_elements(v_acoes) e
   WHERE NOT (v_amap ? coalesce(e->>'id', '')) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Acao "%" referencia um ramo inexistente', v_key USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(nullif(e->>'descricao', ''), 'sem descricao') INTO v_key FROM jsonb_array_elements(v_regras) e
   WHERE NOT (v_rmap ? coalesce(e->>'id', '')) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Regra "%" sem exame-gatilho valido', v_key USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'acoes', v_amap, 'regras', v_rmap);
END;
$fn$;
REVOKE ALL ON FUNCTION public.salvar_protocolo(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_protocolo(jsonb) TO authenticated;

-- 8. Casamento de CID por hierarquia ----------------------------------------
-- PCDTs listam ora a categoria ("E10"), ora as subcategorias ("E10.0"…"E10.9"),
-- e o cadastro do paciente pode estar em qualquer dos dois níveis. A igualdade
-- exata deixava pacientes de fora (protocolo "E10" x paciente "E10.9").
-- Regras: igual; protocolo-categoria cobre as subcategorias do paciente;
-- paciente com só a categoria (3 caracteres) entra nas subcategorias do protocolo.
CREATE OR REPLACE FUNCTION public.cid_compativel(p_cid_protocolo text, p_cid_paciente text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH n AS (
    SELECT upper(regexp_replace(coalesce(p_cid_protocolo, ''), '[^A-Za-z0-9]', '', 'g')) AS pr,
           upper(regexp_replace(coalesce(p_cid_paciente, ''), '[^A-Za-z0-9]', '', 'g')) AS pa
  )
  SELECT pr <> '' AND pa <> '' AND (
    pr = pa
    OR (length(pr) >= 3 AND pa LIKE pr || '%')
    OR (length(pa) = 3 AND pr LIKE pa || '%')
  ) FROM n;
$fn$;
REVOKE ALL ON FUNCTION public.cid_compativel(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cid_compativel(text, text) TO authenticated, service_role;

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
      SELECT 1 FROM public.protocolo_cids pc, unnest(v_cids) AS c(code)
      WHERE pc.protocolo_id = pp.protocolo_id
        AND public.cid_compativel(pc.cid_code, c.code)
    );

  FOR r IN
    SELECT p.id AS protocolo_id,
           (SELECT c.code FROM public.protocolo_cids pc2, unnest(v_cids) AS c(code)
             WHERE pc2.protocolo_id = p.id AND public.cid_compativel(pc2.cid_code, c.code)
             LIMIT 1) AS cid_code
    FROM public.protocolos p
    WHERE p.user_id = v_user
      AND p.ativo = true
      AND EXISTS (
        SELECT 1 FROM public.protocolo_cids pc, unnest(v_cids) AS c(code)
        WHERE pc.protocolo_id = p.id AND public.cid_compativel(pc.cid_code, c.code)
      )
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
-- A aba de protocolos do paciente (public/paciente-protocolos.js) chama esta
-- função direto do navegador ("Sincronizar com CIDs do cadastro" e ao abrir a
-- aba). Ela tinha sido revogada de authenticated (20260731130928), o que fazia
-- o botão sempre falhar com "permission denied". A função já recusa paciente
-- de outro médico (checagem de auth.uid() acima), então volta a ser chamável.
REVOKE EXECUTE ON FUNCTION public.sincronizar_protocolos_paciente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_protocolos_paciente(uuid) TO authenticated, service_role;

-- 9. Studio -> protocolo executável ------------------------------------------
-- O Studio (public/protocolo-studio.html) é onde o protocolo é desenhado; ao
-- publicar, o grafo é compilado (src/lib/protocolos/estudio-compilar.server.ts)
-- para protocolo_acoes/protocolo_regras via salvar_protocolo. "publicacao"
-- guarda o mapa nó do grafo -> uuid da ação/regra, para que republicar
-- atualize as mesmas linhas em vez de recriá-las.
ALTER TABLE public.protocolo_estudio_rascunhos
  ADD COLUMN IF NOT EXISTS protocolo_id uuid REFERENCES public.protocolos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publicacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publicado_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_estudio_rascunhos_protocolo ON public.protocolo_estudio_rascunhos(protocolo_id);
