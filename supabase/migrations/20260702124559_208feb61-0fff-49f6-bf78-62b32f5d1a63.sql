CREATE EXTENSION IF NOT EXISTS pg_trgm;
TRUNCATE TABLE public.medicamentos;
ALTER TABLE public.medicamentos ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.medicamentos ALTER COLUMN id TYPE text USING id::text;
CREATE INDEX IF NOT EXISTS medicamentos_nome_trgm ON public.medicamentos USING gin (lower(nome_comercial) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicamentos_composicao_trgm ON public.medicamentos USING gin (lower(coalesce(composicao,'')) gin_trgm_ops);