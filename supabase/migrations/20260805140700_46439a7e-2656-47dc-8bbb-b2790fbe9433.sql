CREATE TABLE public.lancamentos_financeiros (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  tipo text NOT NULL DEFAULT 'Receita',
  descricao text NOT NULL DEFAULT '',
  paciente_id uuid REFERENCES public.pacientes(paciente_id) ON DELETE SET NULL,
  paciente_nome text,
  medico text,
  especialidade text,
  natureza text,
  data date NOT NULL DEFAULT current_date,
  vencimento date,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'A faturar',
  etiqueta text,
  pago boolean NOT NULL DEFAULT false,
  comissao_pct numeric(6,2) NOT NULL DEFAULT 0,
  comissao_val numeric(14,2) NOT NULL DEFAULT 0,
  nf_numero integer,
  nf_serie text,
  nf_status text,
  nf_emitida_em timestamp with time zone,
  nf_payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lancamentos_financeiros TO authenticated;
GRANT ALL ON public.lancamentos_financeiros TO service_role;

ALTER TABLE public.lancamentos_financeiros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuario gerencia seus lancamentos"
ON public.lancamentos_financeiros FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_lanc_user_data ON public.lancamentos_financeiros(user_id, data DESC);

CREATE TRIGGER trg_lancamentos_updated
BEFORE UPDATE ON public.lancamentos_financeiros
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();