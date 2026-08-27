CREATE TABLE IF NOT EXISTS public.apresentacao_legivel (
  apresentacao text PRIMARY KEY,
  texto_simplificado text NOT NULL,
  posologia_padrao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.apresentacao_legivel TO authenticated;
GRANT ALL ON public.apresentacao_legivel TO service_role;

ALTER TABLE public.apresentacao_legivel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "apresentacao legivel leitura autenticada"
  ON public.apresentacao_legivel
  FOR SELECT
  TO authenticated
  USING (true);