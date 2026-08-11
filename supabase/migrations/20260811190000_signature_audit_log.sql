-- =========================================================
-- signature_audit_log: trilha de auditoria de toda tentativa
-- de assinatura digital ICP-Brasil (sucesso ou falha).
-- Nunca armazena senha, PIN, chave privada, PFX ou token bruto.
-- =========================================================
CREATE TABLE public.signature_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id TEXT,
  certificate_id UUID REFERENCES public.doctor_certificates(id) ON DELETE SET NULL,
  certificate_type TEXT,
  provider TEXT,
  document_hash TEXT,
  signature_status TEXT NOT NULL, -- success | failed
  error_code TEXT,
  error_message TEXT,
  signed_document_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signature_audit_log_user ON public.signature_audit_log(user_id, created_at DESC);
CREATE INDEX idx_signature_audit_log_document ON public.signature_audit_log(document_id);

GRANT SELECT ON public.signature_audit_log TO authenticated;
GRANT ALL ON public.signature_audit_log TO service_role;

ALTER TABLE public.signature_audit_log ENABLE ROW LEVEL SECURITY;

-- Cada médico só enxerga a própria trilha de auditoria.
CREATE POLICY "Doctors read own signature audit log"
  ON public.signature_audit_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Inserções só pelo backend (service_role) — nunca diretamente do frontend.
-- (sem policy de INSERT para authenticated/anon; service_role ignora RLS)

-- =========================================================
-- doctor_certificates: status operacional + último uso, para
-- refletir "Ativo / Expirado / Precisa de autorização" na UI
-- sem precisar recalcular tudo a cada leitura.
-- =========================================================
ALTER TABLE public.doctor_certificates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
