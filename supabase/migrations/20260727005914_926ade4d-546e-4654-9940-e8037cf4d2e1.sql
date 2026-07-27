CREATE TABLE IF NOT EXISTS public.agendamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id UUID REFERENCES public.pacientes(paciente_id) ON DELETE SET NULL,
  paciente_nome TEXT,
  id_medico UUID NOT NULL,
  data_hora TIMESTAMP WITH TIME ZONE NOT NULL,
  duracao_min INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'agendado',
  motivo TEXT,
  origem TEXT DEFAULT 'assistente_ia',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agendamentos_medico_data ON public.agendamentos (id_medico, data_hora);
CREATE INDEX IF NOT EXISTS idx_agendamentos_paciente ON public.agendamentos (paciente_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agendamentos TO authenticated;
GRANT ALL ON public.agendamentos TO service_role;
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam seus agendamentos" ON public.agendamentos FOR ALL TO authenticated USING (auth.uid() = id_medico) WITH CHECK (auth.uid() = id_medico);

CREATE TABLE IF NOT EXISTS public.documentos_paciente (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id UUID REFERENCES public.pacientes(paciente_id) ON DELETE SET NULL,
  paciente_nome TEXT,
  id_medico UUID NOT NULL,
  tipo TEXT NOT NULL,
  conteudo JSONB NOT NULL DEFAULT '{}'::jsonb,
  texto TEXT,
  enviado_em TIMESTAMP WITH TIME ZONE,
  canal_envio TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_paciente_pac ON public.documentos_paciente (paciente_id);
CREATE INDEX IF NOT EXISTS idx_documentos_paciente_medico ON public.documentos_paciente (id_medico, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documentos_paciente TO authenticated;
GRANT ALL ON public.documentos_paciente TO service_role;
ALTER TABLE public.documentos_paciente ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam seus documentos" ON public.documentos_paciente FOR ALL TO authenticated USING (auth.uid() = id_medico) WITH CHECK (auth.uid() = id_medico);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_agendamentos_updated ON public.agendamentos;
CREATE TRIGGER trg_agendamentos_updated BEFORE UPDATE ON public.agendamentos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_documentos_paciente_updated ON public.documentos_paciente;
CREATE TRIGGER trg_documentos_paciente_updated BEFORE UPDATE ON public.documentos_paciente FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();