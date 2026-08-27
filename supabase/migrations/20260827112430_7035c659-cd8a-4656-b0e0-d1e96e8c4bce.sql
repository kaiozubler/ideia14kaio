CREATE TABLE IF NOT EXISTS public.signature_psc_link_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  psc_name text NOT NULL,
  state text NOT NULL UNIQUE,
  redirect_uri text,
  api_key text,
  status text NOT NULL DEFAULT 'pending',
  certificate_subject text,
  holder_document text,
  valid_until timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.signature_psc_link_sessions TO service_role;

ALTER TABLE public.signature_psc_link_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no client access to psc link sessions"
  ON public.signature_psc_link_sessions
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE TRIGGER update_signature_psc_link_sessions_updated_at
  BEFORE UPDATE ON public.signature_psc_link_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS signature_psc_link_sessions_doctor_idx
  ON public.signature_psc_link_sessions (doctor_id, status, created_at DESC);