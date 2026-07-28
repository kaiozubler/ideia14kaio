ALTER TABLE public.doctor_certificates
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'integra_icp',
  ADD COLUMN IF NOT EXISTS certificate_type text NOT NULL DEFAULT 'cloud',
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS issuer text,
  ADD COLUMN IF NOT EXISTS holder_document text,
  ADD COLUMN IF NOT EXISTS label text;

UPDATE public.doctor_certificates
   SET provider = 'integra_icp', certificate_type = 'cloud'
 WHERE provider IS NULL OR certificate_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_certificates_provider
  ON public.doctor_certificates(doctor_id, provider);