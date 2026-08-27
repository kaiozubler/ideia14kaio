ALTER TABLE public.medicamentos
  ADD COLUMN IF NOT EXISTS apresentacao_simplificada text,
  ADD COLUMN IF NOT EXISTS posologia_padrao text;

CREATE INDEX IF NOT EXISTS medicamentos_apresentacao_pendente_idx
  ON public.medicamentos (apresentacao)
  WHERE apresentacao_simplificada IS NULL;