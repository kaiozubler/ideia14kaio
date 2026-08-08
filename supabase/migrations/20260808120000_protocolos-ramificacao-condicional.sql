-- Ramificação condicional em protocolos assistenciais
-- Aditivo: nenhuma coluna/tabela existente é removida ou tem seu comportamento
-- alterado para protocolos sem ramificação.

-- 1. Regras de decisão: uma ação-gatilho (tipicamente um Exame) tem 1+ regras
--    que avaliam o resultado lançado e decidem quais ações do ramo instanciar.
CREATE TABLE public.protocolo_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo_id uuid NOT NULL REFERENCES public.protocolos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  acao_gatilho_id uuid NOT NULL REFERENCES public.protocolo_acoes(id) ON DELETE CASCADE,
  descricao text NOT NULL DEFAULT '',
  -- condicao avalia protocolo_tarefas.resultado_valor, ex:
  --   {"campo":"numero","operador":"maior_que","numero":4.5}
  --   {"campo":"numero","operador":"entre","numero_min":0.4,"numero_max":4.5}
  --   {"campo":"texto","operador":"contem","texto":"positivo"}
  condicao jsonb,
  ordem integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false, -- fallback quando nenhuma condicao bate
  -- Se preenchido, ao disparar esta regra o próprio exame-gatilho é reagendado
  -- N dias após o resultado (em vez de criar uma ação nova) — isso é o que
  -- modela "repetir o exame a cada 30/60 dias dentro deste ramo" sem duplicar
  -- a linha de protocolo_acoes do exame.
  repete_gatilho_apos_dias integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_regra_tem_condicao_ou_default CHECK (condicao IS NOT NULL OR is_default = true)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocolo_regras TO authenticated;
GRANT ALL ON public.protocolo_regras TO service_role;
ALTER TABLE public.protocolo_regras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam regras dos seus protocolos" ON public.protocolo_regras FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. protocolo_acoes: aditivo. Linhas existentes ficam com regra_id NULL,
--    ou seja, continuam sendo pré-geradas exatamente como hoje.
ALTER TABLE public.protocolo_acoes
  ADD COLUMN regra_id uuid REFERENCES public.protocolo_regras(id) ON DELETE CASCADE,
  ADD COLUMN start_day_referencia text NOT NULL DEFAULT 'inicio_protocolo'
    CHECK (start_day_referencia IN ('inicio_protocolo', 'resultado_regra'));
CREATE INDEX idx_protocolo_acoes_regra ON public.protocolo_acoes(regra_id);
CREATE INDEX idx_protocolo_regras_gatilho ON public.protocolo_regras(acao_gatilho_id);

-- 3. protocolo_tarefas: precisa guardar o resultado para a regra avaliar.
ALTER TABLE public.protocolo_tarefas
  ADD COLUMN resultado_valor jsonb,       -- {"numero": 6.2} ou {"texto": "positivo"}
  ADD COLUMN resultado_registrado_em timestamptz;

-- 4. gerar_tarefas_protocolo: só ganha um filtro para não pré-gerar ações
--    que pertencem a um ramo condicional (regra_id IS NOT NULL). O resto do
--    corpo é idêntico ao original.
CREATE OR REPLACE FUNCTION public.gerar_tarefas_protocolo(p_vinculo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v record;
  a record;
  d integer;
  occ integer;
  horizon integer := 730;
BEGIN
  SELECT * INTO v FROM public.paciente_protocolos WHERE id = p_vinculo_id;
  IF NOT FOUND OR v.ativo = false THEN RETURN; END IF;

  FOR a IN
    SELECT * FROM public.protocolo_acoes
    WHERE protocolo_id = v.protocolo_id
      AND regra_id IS NULL -- ações de ramo não são pré-geradas; aguardam resultado
  LOOP
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
$fn$;

-- 5. Comparador de condição, isolado para poder ser testado/reaproveitado.
--    Nunca deixa uma condicao malformada (ex: vinda de geração por IA) quebrar
--    o fluxo — nesse caso, simplesmente não bate (retorna false).
CREATE OR REPLACE FUNCTION public.avaliar_condicao(p_condicao jsonb, p_resultado jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_campo text := p_condicao->>'campo';
  v_operador text := p_condicao->>'operador';
  v_num numeric;
  v_texto text;
BEGIN
  IF p_condicao IS NULL OR p_resultado IS NULL THEN RETURN false; END IF;

  IF v_campo = 'numero' THEN
    IF p_resultado->>'numero' IS NULL THEN RETURN false; END IF;
    v_num := (p_resultado->>'numero')::numeric;
    IF v_operador = 'maior_que' THEN RETURN v_num > (p_condicao->>'numero')::numeric;
    ELSIF v_operador = 'menor_que' THEN RETURN v_num < (p_condicao->>'numero')::numeric;
    ELSIF v_operador = 'entre' THEN
      RETURN v_num BETWEEN (p_condicao->>'numero_min')::numeric AND (p_condicao->>'numero_max')::numeric;
    ELSIF v_operador = 'igual' THEN RETURN v_num = (p_condicao->>'numero')::numeric;
    ELSE RETURN false;
    END IF;
  ELSIF v_campo = 'texto' THEN
    IF p_resultado->>'texto' IS NULL THEN RETURN false; END IF;
    v_texto := lower(trim(p_resultado->>'texto'));
    IF v_operador = 'igual' THEN RETURN v_texto = lower(trim(p_condicao->>'texto'));
    ELSIF v_operador = 'contem' THEN RETURN v_texto LIKE ('%' || lower(trim(p_condicao->>'texto')) || '%');
    ELSE RETURN false;
    END IF;
  END IF;

  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$fn$;

-- 6. RPC principal: chamada quando o resultado de uma tarefa (tipicamente de
--    Exame) é lançado. Avalia as regras da ação-gatilho e:
--      a) instancia as ações do ramo que bateu (protocolo_acoes.regra_id = regra.id)
--      b) se a regra tiver repete_gatilho_apos_dias, reagenda o próprio exame
CREATE OR REPLACE FUNCTION public.avaliar_resultado_tarefa(
  p_tarefa_id uuid,
  p_resultado jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t record;
  regra record;
  alvo record;
  v_due date;
  v_next_occ integer;
BEGIN
  SELECT * INTO t FROM public.protocolo_tarefas WHERE id = p_tarefa_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> t.user_id THEN
    RAISE EXCEPTION 'Tarefa nao pertence ao usuario atual' USING ERRCODE = '42501';
  END IF;

  UPDATE public.protocolo_tarefas
    SET resultado_valor = p_resultado, resultado_registrado_em = now(), status = 'concluido'
    WHERE id = p_tarefa_id;

  -- Primeira regra cuja condicao bate, em ordem; senão a default (se houver)
  SELECT r.* INTO regra
  FROM public.protocolo_regras r
  WHERE r.acao_gatilho_id = t.acao_id
    AND r.is_default = false
    AND public.avaliar_condicao(r.condicao, p_resultado)
  ORDER BY r.ordem
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT r.* INTO regra
    FROM public.protocolo_regras r
    WHERE r.acao_gatilho_id = t.acao_id AND r.is_default = true
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN RETURN; END IF; -- ação sem ramificação associada

  FOR alvo IN SELECT * FROM public.protocolo_acoes WHERE regra_id = regra.id LOOP
    v_due := t.due_date + alvo.start_day;
    INSERT INTO public.protocolo_tarefas
      (user_id, paciente_protocolo_id, acao_id, paciente_id, protocolo_id, ocorrencia, due_date)
    VALUES
      (t.user_id, t.paciente_protocolo_id, alvo.id, t.paciente_id, t.protocolo_id, 0, v_due)
    ON CONFLICT (paciente_protocolo_id, acao_id, ocorrencia) DO NOTHING;
  END LOOP;

  IF regra.repete_gatilho_apos_dias IS NOT NULL THEN
    SELECT COALESCE(MAX(ocorrencia), -1) + 1 INTO v_next_occ
    FROM public.protocolo_tarefas
    WHERE paciente_protocolo_id = t.paciente_protocolo_id AND acao_id = t.acao_id;

    INSERT INTO public.protocolo_tarefas
      (user_id, paciente_protocolo_id, acao_id, paciente_id, protocolo_id, ocorrencia, due_date)
    VALUES
      (t.user_id, t.paciente_protocolo_id, t.acao_id, t.paciente_id, t.protocolo_id,
       v_next_occ, t.due_date + regra.repete_gatilho_apos_dias)
    ON CONFLICT (paciente_protocolo_id, acao_id, ocorrencia) DO NOTHING;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.avaliar_condicao(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.avaliar_resultado_tarefa(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_resultado_tarefa(uuid, jsonb) TO authenticated;

-- Nota de autoria: se um Exame tem regras de ramificação, ele deve ser
-- cadastrado com recurrent = false na própria protocolo_acoes raiz — a
-- repetição passa a ser controlada pelas regras (repete_gatilho_apos_dias),
-- que pode variar por ramo (ex: 30 dias no ramo Y, 60 dias no ramo V),
-- em vez da recorrência cega e fixa do modelo eager.
