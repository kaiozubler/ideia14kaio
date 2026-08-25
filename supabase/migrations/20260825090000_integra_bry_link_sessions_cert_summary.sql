-- Guarda um resumo do certificado escolhido pelo médico no PSC (obtido via
-- GET /auth/certificate no momento do callback), para exibir na tela de
-- "certificado vinculado" sem precisar rechamar a Bry a cada carregamento
-- de página.
ALTER TABLE public.signature_psc_link_sessions
  ADD COLUMN IF NOT EXISTS certificate_subject TEXT,
  ADD COLUMN IF NOT EXISTS holder_document TEXT,
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;
