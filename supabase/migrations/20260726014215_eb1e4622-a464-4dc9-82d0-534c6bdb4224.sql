-- 1. Campos api_id nas tabelas existentes
ALTER TABLE public.medicamentos ADD COLUMN IF NOT EXISTS api_id integer;
ALTER TABLE public.substancias ADD COLUMN IF NOT EXISTS api_id integer;
CREATE INDEX IF NOT EXISTS idx_medicamentos_api_id ON public.medicamentos(api_id);
CREATE INDEX IF NOT EXISTS idx_substancias_api_id ON public.substancias(api_id);

-- 2. Catálogo de fármacos da API CRF-MG
CREATE TABLE IF NOT EXISTS public.medicamentos_crfmg (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id integer NOT NULL UNIQUE,
  nome text NOT NULL,
  nome_normalizado text,
  indicacoes text,
  id_substancia uuid REFERENCES public.substancias(id_substancia) ON DELETE SET NULL,
  ultima_sincronizacao timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crfmg_nome_norm ON public.medicamentos_crfmg(nome_normalizado);
CREATE INDEX IF NOT EXISTS idx_crfmg_substancia ON public.medicamentos_crfmg(id_substancia);

GRANT SELECT ON public.medicamentos_crfmg TO anon, authenticated;
GRANT ALL ON public.medicamentos_crfmg TO service_role;
ALTER TABLE public.medicamentos_crfmg ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Catalogo CRFMG leitura publica" ON public.medicamentos_crfmg FOR SELECT USING (true);

-- 3. Interações
CREATE TABLE IF NOT EXISTS public.interacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_interacao_id integer UNIQUE,
  medicamento_1_id uuid NOT NULL REFERENCES public.medicamentos_crfmg(id) ON DELETE CASCADE,
  medicamento_2_id uuid NOT NULL REFERENCES public.medicamentos_crfmg(id) ON DELETE CASCADE,
  acao text,
  mecanismo_efeito text,
  recomendacoes text,
  ultima_sincronizacao timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interacoes_par_distinto CHECK (medicamento_1_id <> medicamento_2_id),
  CONSTRAINT interacoes_par_unico UNIQUE (medicamento_1_id, medicamento_2_id)
);
CREATE INDEX IF NOT EXISTS idx_interacoes_api_id ON public.interacoes(api_interacao_id);
CREATE INDEX IF NOT EXISTS idx_interacoes_med1 ON public.interacoes(medicamento_1_id);
CREATE INDEX IF NOT EXISTS idx_interacoes_med2 ON public.interacoes(medicamento_2_id);
CREATE INDEX IF NOT EXISTS idx_interacoes_par ON public.interacoes(medicamento_1_id, medicamento_2_id);

GRANT SELECT ON public.interacoes TO anon, authenticated;
GRANT ALL ON public.interacoes TO service_role;
ALTER TABLE public.interacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Interacoes leitura publica" ON public.interacoes FOR SELECT USING (true);

-- 4. Log de sincronização
CREATE TABLE IF NOT EXISTS public.interacoes_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_inicio timestamptz NOT NULL DEFAULT now(),
  data_fim timestamptz,
  quantidade_processada integer NOT NULL DEFAULT 0,
  quantidade_novas integer NOT NULL DEFAULT 0,
  quantidade_atualizadas integer NOT NULL DEFAULT 0,
  quantidade_erros integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'em_andamento',
  ultimo_medicamento_processado text,
  mensagem_erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_log_inicio ON public.interacoes_sync_log(data_inicio DESC);

GRANT ALL ON public.interacoes_sync_log TO service_role;
ALTER TABLE public.interacoes_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Log sincronizacao leitura autenticada" ON public.interacoes_sync_log FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.interacoes_sync_log TO authenticated;

-- 5. Triggers updated_at
CREATE TRIGGER trg_crfmg_updated_at BEFORE UPDATE ON public.medicamentos_crfmg
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_interacoes_updated_at BEFORE UPDATE ON public.interacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sync_log_updated_at BEFORE UPDATE ON public.interacoes_sync_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Ordenação canônica do par (menor UUID sempre em medicamento_1_id)
CREATE OR REPLACE FUNCTION public.interacoes_ordena_par()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE tmp uuid;
BEGIN
  IF NEW.medicamento_1_id > NEW.medicamento_2_id THEN
    tmp := NEW.medicamento_1_id;
    NEW.medicamento_1_id := NEW.medicamento_2_id;
    NEW.medicamento_2_id := tmp;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_interacoes_ordena_par BEFORE INSERT OR UPDATE ON public.interacoes
  FOR EACH ROW EXECUTE FUNCTION public.interacoes_ordena_par();

-- 7. Consulta local de interações durante a prescrição
CREATE OR REPLACE FUNCTION public.verificar_interacoes(p_termos text[])
RETURNS TABLE(
  id uuid,
  farmaco_1 text,
  farmaco_2 text,
  acao text,
  mecanismo_efeito text,
  recomendacoes text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH termos AS (
    SELECT DISTINCT public.normaliza_substancia(t) AS termo
    FROM unnest(p_termos) AS t
    WHERE coalesce(trim(t), '') <> ''
  ),
  alvos AS (
    SELECT DISTINCT mc.id, mc.nome
    FROM public.medicamentos_crfmg mc
    JOIN termos ON termos.termo LIKE '%' || mc.nome_normalizado || '%'
                OR mc.nome_normalizado LIKE '%' || termos.termo || '%'
  )
  SELECT i.id, a.nome, b.nome, i.acao, i.mecanismo_efeito, i.recomendacoes
  FROM public.interacoes i
  JOIN alvos a ON a.id = i.medicamento_1_id
  JOIN alvos b ON b.id = i.medicamento_2_id;
$$;

GRANT EXECUTE ON FUNCTION public.verificar_interacoes(text[]) TO anon, authenticated;