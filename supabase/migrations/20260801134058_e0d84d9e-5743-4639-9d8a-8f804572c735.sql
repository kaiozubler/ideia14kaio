CREATE TABLE public.assinaturas_digitais (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  consulta_id uuid REFERENCES public.consulta(id) ON DELETE SET NULL,
  documento_id uuid REFERENCES public.documentos_paciente(id) ON DELETE SET NULL,
  paciente_nome text,
  paciente_email text,
  tipo_documento text NOT NULL,
  bry_envelope_id text,
  status text NOT NULL DEFAULT 'PENDING',
  sign_url text,
  download_url text,
  arquivo_assinado text,
  erro text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_assinaturas_digitais_envelope ON public.assinaturas_digitais (bry_envelope_id);
CREATE INDEX idx_assinaturas_digitais_user ON public.assinaturas_digitais (user_id);

GRANT SELECT ON public.assinaturas_digitais TO authenticated;
GRANT ALL ON public.assinaturas_digitais TO service_role;

ALTER TABLE public.assinaturas_digitais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own signatures"
  ON public.assinaturas_digitais FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_assinaturas_digitais_updated_at
  BEFORE UPDATE ON public.assinaturas_digitais
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();