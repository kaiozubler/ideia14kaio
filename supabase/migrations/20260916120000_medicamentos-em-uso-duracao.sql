-- Medicamentos em uso pelo paciente, com a data de término do tratamento.
-- Alimentada quando uma receita é gerada. É essa tabela que as automações de IA
-- consultam para saber quem está tomando o quê e até quando.
CREATE TABLE public.medicamentos_em_uso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  paciente_id uuid NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  documento_id uuid REFERENCES public.documentos_paciente(id) ON DELETE SET NULL,

  medicamento_nome text NOT NULL,
  apresentacao text,
  posologia text,

  -- duração como o médico digitou (ex.: 2 + 'semanas') e já normalizada em dias
  duracao_valor integer,
  duracao_unidade text CHECK (duracao_unidade IS NULL OR duracao_unidade IN ('dias','semanas','meses')),
  duracao_dias integer,
  uso_continuo boolean NOT NULL DEFAULT false,

  data_inicio date NOT NULL DEFAULT current_date,
  data_fim date, -- nulo quando uso_continuo = true

  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT medicamentos_em_uso_fim_coerente CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicamentos_em_uso TO authenticated;
GRANT ALL ON public.medicamentos_em_uso TO service_role;
ALTER TABLE public.medicamentos_em_uso ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Medicos gerenciam medicamentos em uso de seus pacientes"
  ON public.medicamentos_em_uso FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_medicamentos_em_uso_updated BEFORE UPDATE ON public.medicamentos_em_uso
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_medicamentos_em_uso_paciente ON public.medicamentos_em_uso(paciente_id);
CREATE INDEX idx_medicamentos_em_uso_data_fim ON public.medicamentos_em_uso(data_fim);
