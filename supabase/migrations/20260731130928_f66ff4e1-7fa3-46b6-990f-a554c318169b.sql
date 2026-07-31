-- 1) Reference/catalog tables: authenticated read only, no client writes
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.medicamentos, public.substancias, public.medicamento_substancias,
  public.medicamentos_crfmg, public.interacoes, public.interacoes_medicamentosas,
  public.interacoes_sync_log
FROM anon, authenticated;

REVOKE SELECT ON
  public.medicamentos, public.substancias, public.medicamento_substancias,
  public.medicamentos_crfmg, public.interacoes, public.interacoes_medicamentosas
FROM anon;

DROP POLICY IF EXISTS "Medicamentos são públicos para leitura" ON public.medicamentos;
CREATE POLICY "Medicamentos leitura autenticada" ON public.medicamentos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Substancias leitura publica" ON public.substancias;
CREATE POLICY "Substancias leitura autenticada" ON public.substancias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Medicamento substancias leitura publica" ON public.medicamento_substancias;
CREATE POLICY "Medicamento substancias leitura autenticada" ON public.medicamento_substancias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Catalogo CRFMG leitura publica" ON public.medicamentos_crfmg;
CREATE POLICY "Catalogo CRFMG leitura autenticada" ON public.medicamentos_crfmg
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Interacoes leitura publica" ON public.interacoes;
CREATE POLICY "Interacoes leitura autenticada" ON public.interacoes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Interacoes leitura publica" ON public.interacoes_medicamentosas;
CREATE POLICY "Interacoes medicamentosas leitura autenticada" ON public.interacoes_medicamentosas
  FOR SELECT TO authenticated USING (true);

-- 2) Sync log: internal only
DROP POLICY IF EXISTS "Log sincronizacao leitura autenticada" ON public.interacoes_sync_log;
REVOKE SELECT ON public.interacoes_sync_log FROM anon, authenticated;
CREATE POLICY "Log sincronizacao sem acesso ao cliente" ON public.interacoes_sync_log
  FOR SELECT TO authenticated USING (false);
GRANT ALL ON public.interacoes_sync_log TO service_role;

-- 3) doctor_certificates: owner read only, writes reserved for internal server code
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.doctor_certificates
  FROM anon, authenticated;
REVOKE SELECT ON public.doctor_certificates FROM anon;
DROP POLICY IF EXISTS "Doctors read own certificates" ON public.doctor_certificates;
CREATE POLICY "Doctors read own certificates" ON public.doctor_certificates
  FOR SELECT TO authenticated USING (auth.uid() = doctor_id);
CREATE POLICY "Certificados sem insert pelo cliente" ON public.doctor_certificates
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Certificados sem update pelo cliente" ON public.doctor_certificates
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Certificados sem delete pelo cliente" ON public.doctor_certificates
  FOR DELETE TO authenticated USING (false);
GRANT ALL ON public.doctor_certificates TO service_role;

-- 4) SECURITY DEFINER helper not called by clients: remove direct execute
REVOKE EXECUTE ON FUNCTION public.sincronizar_protocolos_paciente(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gerar_tarefas_protocolo(uuid) FROM anon, authenticated;
