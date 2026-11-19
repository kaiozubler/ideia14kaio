ALTER TABLE public.interacoes ENABLE ROW LEVEL SECURITY;
ALTER POLICY "Interacoes leitura autenticada" ON public.interacoes
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND NOT public.acesso_bloqueado((SELECT auth.uid())));
REVOKE ALL ON public.interacoes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.interacoes FROM authenticated;
GRANT SELECT ON public.interacoes TO authenticated;
GRANT ALL ON public.interacoes TO service_role;

ALTER TABLE public.tuss_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tuss_log_leitura_autenticada" ON public.tuss_sync_log;
REVOKE ALL ON public.tuss_sync_log FROM anon, authenticated;
GRANT ALL ON public.tuss_sync_log TO service_role;
