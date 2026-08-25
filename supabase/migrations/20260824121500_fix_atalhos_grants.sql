-- Correção defensiva: a tabela prompt_comandos (atalhos de comando "/algo")
-- foi criada em 20260820120000_base_conhecimento.sql sem GRANT explícito
-- para o papel "authenticated". Sem esse GRANT, qualquer SELECT/INSERT/
-- DELETE feito pelo cliente (Assistente IA, Chat IA e a tela "Base de
-- conhecimento") falha com "permission denied" — erro que só aparece no
-- console do navegador, então na prática os atalhos pareciam simplesmente
-- "não funcionar". A migration 20260822122053 já corrige isso, mas esta
-- migration é idempotente e reforça a garantia caso aquela não tenha sido
-- aplicada em algum ambiente.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_comandos TO authenticated;
GRANT ALL ON public.prompt_comandos TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'prompt_comandos'
      AND policyname = 'medico_gerencia_seus_atalhos'
  ) THEN
    CREATE POLICY "medico_gerencia_seus_atalhos"
      ON public.prompt_comandos
      FOR ALL
      USING (medico_id = auth.uid())
      WITH CHECK (medico_id = auth.uid());
  END IF;
END $$;
