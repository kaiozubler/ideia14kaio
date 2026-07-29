CREATE TABLE public.protocolos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  titulo text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocolos TO authenticated;
GRANT ALL ON public.protocolos TO service_role;
ALTER TABLE public.protocolos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam seus protocolos" ON public.protocolos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_protocolos_updated BEFORE UPDATE ON public.protocolos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.protocolo_cids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo_id uuid NOT NULL REFERENCES public.protocolos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  cid_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (protocolo_id, cid_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocolo_cids TO authenticated;
GRANT ALL ON public.protocolo_cids TO service_role;
ALTER TABLE public.protocolo_cids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam cids dos seus protocolos" ON public.protocolo_cids FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.protocolo_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo_id uuid NOT NULL REFERENCES public.protocolos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  tipo text NOT NULL DEFAULT 'Exame',
  nome text NOT NULL,
  start_day integer NOT NULL DEFAULT 0,
  frequency integer NOT NULL DEFAULT 90,
  recurrent boolean NOT NULL DEFAULT true,
  auto_restart boolean NOT NULL DEFAULT false,
  especialidade text,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocolo_acoes TO authenticated;
GRANT ALL ON public.protocolo_acoes TO service_role;
ALTER TABLE public.protocolo_acoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam acoes dos seus protocolos" ON public.protocolo_acoes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_protocolo_acoes_updated BEFORE UPDATE ON public.protocolo_acoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.paciente_protocolos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  paciente_id uuid NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  protocolo_id uuid NOT NULL REFERENCES public.protocolos(id) ON DELETE CASCADE,
  cid_code text,
  iniciado_em date NOT NULL DEFAULT current_date,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paciente_id, protocolo_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paciente_protocolos TO authenticated;
GRANT ALL ON public.paciente_protocolos TO service_role;
ALTER TABLE public.paciente_protocolos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam vinculos de protocolo" ON public.paciente_protocolos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_paciente_protocolos_updated BEFORE UPDATE ON public.paciente_protocolos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.protocolo_tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  paciente_protocolo_id uuid NOT NULL REFERENCES public.paciente_protocolos(id) ON DELETE CASCADE,
  acao_id uuid NOT NULL REFERENCES public.protocolo_acoes(id) ON DELETE CASCADE,
  paciente_id uuid NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  protocolo_id uuid NOT NULL REFERENCES public.protocolos(id) ON DELETE CASCADE,
  ocorrencia integer NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'nao_avisado',
  notice_type text,
  notice_desc text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paciente_protocolo_id, acao_id, ocorrencia)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocolo_tarefas TO authenticated;
GRANT ALL ON public.protocolo_tarefas TO service_role;
ALTER TABLE public.protocolo_tarefas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam tarefas de protocolo" ON public.protocolo_tarefas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_protocolo_tarefas_updated BEFORE UPDATE ON public.protocolo_tarefas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_protocolo_tarefas_user_due ON public.protocolo_tarefas(user_id, due_date);
CREATE INDEX idx_paciente_protocolos_pac ON public.paciente_protocolos(paciente_id);
CREATE INDEX idx_protocolo_cids_code ON public.protocolo_cids(cid_code);

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

  FOR a IN SELECT * FROM public.protocolo_acoes WHERE protocolo_id = v.protocolo_id LOOP
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
  FOR r IN SELECT paciente_id FROM public.pacientes WHERE user_id = v_user LOOP
    PERFORM public.sincronizar_protocolos_paciente(r.paciente_id);
  END LOOP;
  FOR r IN SELECT id FROM public.paciente_protocolos WHERE protocolo_id = p_protocolo_id AND ativo = true LOOP
    PERFORM public.gerar_tarefas_protocolo(r.id);
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.trg_pacientes_sync_protocolos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.cids IS DISTINCT FROM OLD.cids THEN
    PERFORM public.sincronizar_protocolos_paciente(NEW.paciente_id);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_pacientes_protocolos
AFTER INSERT OR UPDATE OF cids ON public.pacientes
FOR EACH ROW EXECUTE FUNCTION public.trg_pacientes_sync_protocolos();

CREATE OR REPLACE FUNCTION public.relatorio_protocolos()
RETURNS TABLE(
  id uuid, paciente_id uuid, patient text, age integer, cid text,
  protocol text, protocolo_id uuid, action text, action_type text,
  doctor text, specialty text, due date, status text,
  notice_type text, notice_desc text, late boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT t.id, t.paciente_id, pa.name,
         CASE WHEN pa.data_nascimento IS NULL THEN NULL
              ELSE EXTRACT(YEAR FROM age(pa.data_nascimento))::int END,
         COALESCE(pp.cid_code, ''),
         pr.titulo, pr.id, ac.nome, ac.tipo,
         COALESCE(pa.medico, ''), COALESCE(ac.especialidade, ''),
         t.due_date, t.status, t.notice_type,
         COALESCE(t.notice_desc, 'Nenhum aviso enviado'),
         (t.due_date < current_date AND t.status IN ('nao_avisado','avisado'))
  FROM public.protocolo_tarefas t
  JOIN public.paciente_protocolos pp ON pp.id = t.paciente_protocolo_id
  JOIN public.protocolos pr ON pr.id = t.protocolo_id
  JOIN public.protocolo_acoes ac ON ac.id = t.acao_id
  JOIN public.pacientes pa ON pa.paciente_id = t.paciente_id
  WHERE t.user_id = auth.uid()
    AND t.status <> 'ignorado'
    AND pp.ativo = true
  ORDER BY t.due_date;
$fn$;