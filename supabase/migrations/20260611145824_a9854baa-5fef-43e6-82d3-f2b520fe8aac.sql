CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.pacientes (
  paciente_id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  name TEXT NOT NULL,
  data_nascimento DATE,
  telefone TEXT,
  email TEXT,
  mae TEXT,
  pai TEXT,
  endereco TEXT,
  sus TEXT,
  convenio TEXT DEFAULT 'Particular',
  sexo TEXT,
  medico TEXT,
  grupo TEXT,
  ocupacao TEXT,
  cpf TEXT,
  dados_clinicos TEXT,
  info_complementar JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pacientes TO authenticated;
GRANT ALL ON public.pacientes TO service_role;
ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own pacientes"
ON public.pacientes FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_pacientes_updated_at
BEFORE UPDATE ON public.pacientes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.consulta (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id UUID NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  id_medico UUID NOT NULL DEFAULT auth.uid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  title TEXT,
  acao TEXT DEFAULT 'Consulta',
  resumo TEXT,
  notas TEXT,
  nota_personal TEXT,
  anamnese_ia TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consulta TO authenticated;
GRANT ALL ON public.consulta TO service_role;
ALTER TABLE public.consulta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own consultas"
ON public.consulta FOR ALL TO authenticated
USING (auth.uid() = id_medico)
WITH CHECK (auth.uid() = id_medico);
CREATE TRIGGER update_consulta_updated_at
BEFORE UPDATE ON public.consulta
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.exames (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id UUID NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  nome TEXT NOT NULL,
  tipo TEXT,
  data TEXT,
  obs TEXT,
  file_name TEXT,
  validade TEXT,
  validade_dias INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exames TO authenticated;
GRANT ALL ON public.exames TO service_role;
ALTER TABLE public.exames ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own exames"
ON public.exames FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_exames_updated_at
BEFORE UPDATE ON public.exames
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.timeline_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id UUID NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  event_date TEXT NOT NULL,
  type TEXT NOT NULL,
  icon TEXT NOT NULL,
  title TEXT NOT NULL,
  sub TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timeline_events TO authenticated;
GRANT ALL ON public.timeline_events TO service_role;
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own timeline events"
ON public.timeline_events FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.resumo_prontuario (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  paciente_id UUID NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  id_medico UUID NOT NULL DEFAULT auth.uid(),
  resumo TEXT NOT NULL,
  paciente_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resumo_prontuario TO authenticated;
GRANT ALL ON public.resumo_prontuario TO service_role;
ALTER TABLE public.resumo_prontuario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own resumo prontuario"
ON public.resumo_prontuario FOR ALL TO authenticated
USING (auth.uid() = id_medico)
WITH CHECK (auth.uid() = id_medico);
CREATE TRIGGER update_resumo_prontuario_updated_at
BEFORE UPDATE ON public.resumo_prontuario
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.mensagens_consulta (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  id_consulta UUID NOT NULL REFERENCES public.consulta(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensagens_consulta TO authenticated;
GRANT ALL ON public.mensagens_consulta TO service_role;
ALTER TABLE public.mensagens_consulta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own consulta messages"
ON public.mensagens_consulta FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.anamnese_models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  readonly BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anamnese_models TO authenticated;
GRANT ALL ON public.anamnese_models TO service_role;
ALTER TABLE public.anamnese_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own anamnese models"
ON public.anamnese_models FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_anamnese_models_updated_at
BEFORE UPDATE ON public.anamnese_models
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pacientes_user_id ON public.pacientes(user_id);
CREATE INDEX idx_consulta_paciente_id ON public.consulta(paciente_id);
CREATE INDEX idx_exames_paciente_id ON public.exames(paciente_id);
CREATE INDEX idx_timeline_events_paciente_id ON public.timeline_events(paciente_id);
CREATE INDEX idx_resumo_prontuario_paciente_id ON public.resumo_prontuario(paciente_id);
CREATE INDEX idx_mensagens_consulta_id_consulta ON public.mensagens_consulta(id_consulta);
CREATE INDEX idx_anamnese_models_user_id ON public.anamnese_models(user_id);