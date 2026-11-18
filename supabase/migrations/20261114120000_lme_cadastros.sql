-- Cadastros que o LME (Componente Especializado da Assistência Farmacêutica)
-- consome em vez de pedir a cada emissão.
--
-- 1) Estabelecimentos CNES: o campo 1 do LME pede o CNES do estabelecimento
--    solicitante. Consultório particular sem CNES próprio emite o LME pelo
--    estabelecimento público onde o médico atende (UBS, ambulatório, CEAF), e um
--    mesmo médico costuma usar mais de um. Fica um cadastro por clínica com um
--    padrão, escolhido no LME.
CREATE TABLE IF NOT EXISTS public.lme_estabelecimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.clinica_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  cnes text NOT NULL CHECK (cnes ~ '^[0-9]{7}$'),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  municipio text,
  uf text CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  tipo text NOT NULL DEFAULT 'publico' CHECK (tipo IN ('publico', 'proprio')),
  padrao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cnes)
);

CREATE UNIQUE INDEX IF NOT EXISTS lme_estabelecimentos_um_padrao
  ON public.lme_estabelecimentos (user_id) WHERE padrao;

ALTER TABLE public.lme_estabelecimentos ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lme_estabelecimentos TO authenticated;
GRANT ALL ON public.lme_estabelecimentos TO service_role;

-- O LME é documento do médico (a equipe não lê documentos), então só o dono da conta.
DROP POLICY IF EXISTS "Medico gerencia seus estabelecimentos do LME" ON public.lme_estabelecimentos;
CREATE POLICY "Medico gerencia seus estabelecimentos do LME"
  ON public.lme_estabelecimentos
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP TRIGGER IF EXISTS trg_lme_estabelecimentos_updated ON public.lme_estabelecimentos;
CREATE TRIGGER trg_lme_estabelecimentos_updated
  BEFORE UPDATE ON public.lme_estabelecimentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Raça/cor (IBGE) e etnia indígena são campos obrigatórios do LME e também
--    dado cadastral do SUS: ficam no cadastro do paciente, expostos na visão da
--    equipe e aceitos pela função de gravação, como a naturalidade.
ALTER TABLE public.pacientes ADD COLUMN IF NOT EXISTS raca_cor text;
ALTER TABLE public.pacientes ADD COLUMN IF NOT EXISTS etnia text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pacientes_raca_cor_check') THEN
    ALTER TABLE public.pacientes ADD CONSTRAINT pacientes_raca_cor_check
      CHECK (raca_cor IS NULL OR raca_cor IN ('branca', 'preta', 'parda', 'amarela', 'indigena'));
  END IF;
END $$;

-- Colunas novas no fim: CREATE OR REPLACE VIEW só aceita acrescentar colunas.
CREATE OR REPLACE VIEW public.pacientes_cadastro WITH (security_barrier = true) AS
  SELECT paciente_id, user_id, name, data_nascimento, telefone, email, mae, pai, endereco,
         cep, logradouro, numero, complemento, bairro, cidade, uf, sus,
         convenio, sexo, medico, grupo, ocupacao, cpf, created_at, updated_at, naturalidade,
         raca_cor, etnia
  FROM public.pacientes
  WHERE user_id = (SELECT public.clinica_id());

REVOKE ALL ON public.pacientes_cadastro FROM anon;
GRANT SELECT ON public.pacientes_cadastro TO authenticated;

CREATE OR REPLACE FUNCTION public.paciente_cadastro_salvar(p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid := public.clinica_id();
  novo uuid;
  d jsonb := coalesce(p_dados, '{}'::jsonb);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    IF coalesce(btrim(d->>'name'), '') = '' THEN
      RAISE EXCEPTION 'Informe o nome do paciente.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.pacientes (user_id, name, data_nascimento, telefone, email, mae, pai, endereco,
      cep, logradouro, numero, complemento, bairro, cidade, uf, sus, convenio, sexo, medico, grupo, ocupacao, cpf, naturalidade,
      raca_cor, etnia)
    VALUES (cid, btrim(d->>'name'), nullif(d->>'data_nascimento', '')::date, d->>'telefone', d->>'email', d->>'mae', d->>'pai',
      d->>'endereco', d->>'cep', d->>'logradouro', d->>'numero', d->>'complemento', d->>'bairro', d->>'cidade', d->>'uf',
      d->>'sus', coalesce(nullif(d->>'convenio', ''), 'Particular'), d->>'sexo', d->>'medico', d->>'grupo', d->>'ocupacao', d->>'cpf',
      d->>'naturalidade', nullif(d->>'raca_cor', ''), d->>'etnia')
    RETURNING paciente_id INTO novo;
    RETURN novo;
  END IF;
  UPDATE public.pacientes SET
    name = CASE WHEN d ? 'name' AND btrim(d->>'name') <> '' THEN btrim(d->>'name') ELSE name END,
    data_nascimento = CASE WHEN d ? 'data_nascimento' THEN nullif(d->>'data_nascimento', '')::date ELSE data_nascimento END,
    telefone = CASE WHEN d ? 'telefone' THEN d->>'telefone' ELSE telefone END,
    email = CASE WHEN d ? 'email' THEN d->>'email' ELSE email END,
    mae = CASE WHEN d ? 'mae' THEN d->>'mae' ELSE mae END,
    pai = CASE WHEN d ? 'pai' THEN d->>'pai' ELSE pai END,
    endereco = CASE WHEN d ? 'endereco' THEN d->>'endereco' ELSE endereco END,
    cep = CASE WHEN d ? 'cep' THEN d->>'cep' ELSE cep END,
    logradouro = CASE WHEN d ? 'logradouro' THEN d->>'logradouro' ELSE logradouro END,
    numero = CASE WHEN d ? 'numero' THEN d->>'numero' ELSE numero END,
    complemento = CASE WHEN d ? 'complemento' THEN d->>'complemento' ELSE complemento END,
    bairro = CASE WHEN d ? 'bairro' THEN d->>'bairro' ELSE bairro END,
    cidade = CASE WHEN d ? 'cidade' THEN d->>'cidade' ELSE cidade END,
    uf = CASE WHEN d ? 'uf' THEN d->>'uf' ELSE uf END,
    sus = CASE WHEN d ? 'sus' THEN d->>'sus' ELSE sus END,
    convenio = CASE WHEN d ? 'convenio' THEN d->>'convenio' ELSE convenio END,
    sexo = CASE WHEN d ? 'sexo' THEN d->>'sexo' ELSE sexo END,
    medico = CASE WHEN d ? 'medico' THEN d->>'medico' ELSE medico END,
    grupo = CASE WHEN d ? 'grupo' THEN d->>'grupo' ELSE grupo END,
    ocupacao = CASE WHEN d ? 'ocupacao' THEN d->>'ocupacao' ELSE ocupacao END,
    cpf = CASE WHEN d ? 'cpf' THEN d->>'cpf' ELSE cpf END,
    naturalidade = CASE WHEN d ? 'naturalidade' THEN d->>'naturalidade' ELSE naturalidade END,
    raca_cor = CASE WHEN d ? 'raca_cor' THEN nullif(d->>'raca_cor', '') ELSE raca_cor END,
    etnia = CASE WHEN d ? 'etnia' THEN d->>'etnia' ELSE etnia END
  WHERE paciente_id = p_id AND user_id = cid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.paciente_cadastro_salvar(uuid, jsonb) TO authenticated;
