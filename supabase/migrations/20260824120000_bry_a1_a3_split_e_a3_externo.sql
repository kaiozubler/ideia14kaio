-- =========================================================
-- Diferencia A1 Bry / A3 Bry (mesmo provider "bry_cloud", metadado
-- explícito) e adiciona suporte a A3 externo (token/smartcard local,
-- assinado no navegador via fluxo de duas fases: digest -> assinatura
-- local -> finalização).
-- =========================================================

-- Rótulo legível para exibir na UI (ex.: "A1 em nuvem (BRy)", "A3 em nuvem (BRy)").
ALTER TABLE public.doctor_certificates
  ADD COLUMN IF NOT EXISTS certificate_subtype TEXT;

COMMENT ON COLUMN public.doctor_certificates.certificate_subtype IS
  'Detalha certificate_type quando necessário: a1 | a3 para certificados custodiados na BRy (provider=bry_cloud); a3_token para A3 externo (provider=bry_a3_externo).';

-- Certificados bry_cloud existentes eram todos tratados como A1 até aqui.
UPDATE public.doctor_certificates
   SET certificate_subtype = 'a1'
 WHERE provider = 'bry_cloud' AND certificate_subtype IS NULL;

-- =========================================================
-- signature_sign_sessions: placeholder de PDF + digest, aguardando a
-- assinatura ser produzida localmente (token/smartcard A3 externo) e
-- devolvida para finalização. Mesma política de signature_pkce_sessions:
-- somente service_role acessa (via server routes), expira em 15 min.
-- =========================================================
CREATE TABLE public.signature_sign_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  digest_base64 TEXT NOT NULL,
  placeholder_pdf BYTEA NOT NULL,
  reason TEXT,
  signer_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | consumed | expired
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sign_sessions_doctor ON public.signature_sign_sessions(doctor_id);

-- Sem GRANT para authenticated/anon: apenas service_role acessa (via server routes).
GRANT ALL ON public.signature_sign_sessions TO service_role;

ALTER TABLE public.signature_sign_sessions ENABLE ROW LEVEL SECURITY;
