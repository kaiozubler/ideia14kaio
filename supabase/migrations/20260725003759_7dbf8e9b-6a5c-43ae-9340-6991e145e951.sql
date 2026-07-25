ALTER TABLE public.doctor_certificates
  ADD COLUMN IF NOT EXISTS code_verifier_encrypted TEXT;