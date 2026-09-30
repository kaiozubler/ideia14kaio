-- Dados da clínica usados no cabeçalho/rodapé dos documentos (receita,
-- atestado, solicitação de exame etc.) — nome fantasia, endereço, contato,
-- logo e cor de destaque. Até agora esses dados só existiam no localStorage
-- do navegador (chave "clinicaCfg" em medicopilot.html), então qualquer
-- geração de documento fora do navegador (ex.: o assistente pelo WhatsApp)
-- não tinha como montar o mesmo cabeçalho que o médico já usa no app.
--
-- logo_data_url guarda a logo como data URL (mesmo formato já usado no
-- localStorage) para não precisar de um bucket de storage separado só para
-- isso — o arquivo é pequeno (a tela já limita a 2MB) e é lido raramente
-- (só na geração de documentos).
CREATE TABLE IF NOT EXISTS public.medico_clinica_config (
  id_medico uuid primary key references auth.users(id) on delete cascade,
  fantasia text,
  razao_social text,
  cnpj_cpf text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  pais text default 'Brasil',
  telefone text,
  email text,
  cor_primaria text,
  logo_data_url text,
  updated_at timestamptz not null default now()
);

GRANT ALL ON public.medico_clinica_config TO service_role;
ALTER TABLE public.medico_clinica_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Medico gerencia sua propria config de clinica"
  ON public.medico_clinica_config
  FOR ALL TO authenticated
  USING (auth.uid() = id_medico)
  WITH CHECK (auth.uid() = id_medico);

DROP TRIGGER IF EXISTS trg_medico_clinica_config_updated ON public.medico_clinica_config;
CREATE TRIGGER trg_medico_clinica_config_updated
  BEFORE UPDATE ON public.medico_clinica_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
