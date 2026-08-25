-- =========================================================
-- Correção: A3 externo passa a ser "certificado hospedado por outro PSC"
-- via Integra Bry (redirect + link), não mais token/smartcard local via
-- driver PKCS#11. Ver docs/BRY_CERTIFICADOS.md.
--
-- signature_sign_sessions (da migration anterior) guardava o placeholder
-- PDF + digest para assinatura local — não é mais usado, ninguém tem
-- certificado provider='bry_a3_externo' em produção ainda (feature nunca
-- foi liberada para os médicos), então dropar é seguro.
-- =========================================================

DROP TABLE IF EXISTS public.signature_sign_sessions;

-- =========================================================
-- signature_psc_link_sessions: sessão de link com um PSC externo via
-- Integra Bry (POST /api/service/psc/link). Guarda o `state` (para
-- correlacionar o redirect de volta) e o `api_key` (credencial da BRy
-- para /auth/info, /auth/certificate e a assinatura em si) — TTL padrão
-- 15 min, mesma política de signature_pkce_sessions.
-- =========================================================
CREATE TABLE public.signature_psc_link_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  psc_name TEXT NOT NULL,
  state TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  api_key TEXT, -- pode ser nulo até o callback confirmar (ver comentário em IntegraBryApi.createLink)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | linked | expired
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_psc_link_sessions_state ON public.signature_psc_link_sessions(state);
CREATE INDEX idx_psc_link_sessions_doctor ON public.signature_psc_link_sessions(doctor_id);

-- Sem GRANT para authenticated/anon: apenas service_role acessa (via server routes).
GRANT ALL ON public.signature_psc_link_sessions TO service_role;

ALTER TABLE public.signature_psc_link_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.doctor_certificates.certificate_subtype IS
  'Detalha certificate_type quando necessário: a1 | a3 para certificados custodiados na BRy (provider=bry_cloud). Certificados de PSC externo (Integra Bry) não viram linha em doctor_certificates — vivem em signature_psc_link_sessions, sessão de curta duração.';
