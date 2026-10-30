-- Naturalidade (município/UF de nascimento) faz parte da identificação do
-- paciente exigida pela Res. CFM 1.638/2002 e sai no PDF do prontuário. É dado
-- cadastral, então a equipe lê pela visão e grava pela função, como o resto do cadastro.
ALTER TABLE public.pacientes ADD COLUMN IF NOT EXISTS naturalidade text;

-- Coluna nova no fim: CREATE OR REPLACE VIEW só aceita acrescentar colunas.
CREATE OR REPLACE VIEW public.pacientes_cadastro WITH (security_barrier = true) AS
  SELECT paciente_id, user_id, name, data_nascimento, telefone, email, mae, pai, endereco,
         cep, logradouro, numero, complemento, bairro, cidade, uf, sus,
         convenio, sexo, medico, grupo, ocupacao, cpf, created_at, updated_at, naturalidade
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
      cep, logradouro, numero, complemento, bairro, cidade, uf, sus, convenio, sexo, medico, grupo, ocupacao, cpf, naturalidade)
    VALUES (cid, btrim(d->>'name'), nullif(d->>'data_nascimento', '')::date, d->>'telefone', d->>'email', d->>'mae', d->>'pai',
      d->>'endereco', d->>'cep', d->>'logradouro', d->>'numero', d->>'complemento', d->>'bairro', d->>'cidade', d->>'uf',
      d->>'sus', coalesce(nullif(d->>'convenio', ''), 'Particular'), d->>'sexo', d->>'medico', d->>'grupo', d->>'ocupacao', d->>'cpf',
      d->>'naturalidade')
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
    naturalidade = CASE WHEN d ? 'naturalidade' THEN d->>'naturalidade' ELSE naturalidade END
  WHERE paciente_id = p_id AND user_id = cid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.paciente_cadastro_salvar(uuid, jsonb) TO authenticated;
