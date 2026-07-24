
-- =========================================================
-- doctor_certificates: certificado ICP-Brasil ativo por médico
-- =========================================================
CREATE TABLE public.doctor_certificates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  provider_name TEXT,
  product_name TEXT,
  certificate_subject TEXT,
  certificate_serial TEXT,
  certificate_fingerprint TEXT,
  certificate_valid_from TIMESTAMPTZ,
  certificate_valid_until TIMESTAMPTZ,
  credential_expires_at TIMESTAMPTZ,
  raw_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, credential_id)
);

CREATE INDEX idx_doctor_certificates_doctor ON public.doctor_certificates(doctor_id);

GRANT SELECT ON public.doctor_certificates TO authenticated;
GRANT ALL ON public.doctor_certificates TO service_role;

ALTER TABLE public.doctor_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Doctors read own certificates"
  ON public.doctor_certificates FOR SELECT
  TO authenticated
  USING (auth.uid() = doctor_id);

CREATE TRIGGER update_doctor_certificates_updated_at
  BEFORE UPDATE ON public.doctor_certificates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- signature_pkce_sessions: code_verifier temporário (criptografado)
-- =========================================================
CREATE TABLE public.signature_pkce_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id TEXT,
  code_verifier_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | consumed | expired
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pkce_sessions_doctor ON public.signature_pkce_sessions(doctor_id);
CREATE INDEX idx_pkce_sessions_request ON public.signature_pkce_sessions(request_id);

-- Sem GRANT para authenticated/anon: apenas service_role acessa (via server routes).
GRANT ALL ON public.signature_pkce_sessions TO service_role;

ALTER TABLE public.signature_pkce_sessions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_signature_pkce_sessions_updated_at
  BEFORE UPDATE ON public.signature_pkce_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
