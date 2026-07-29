REVOKE ALL ON FUNCTION public.gerar_tarefas_protocolo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_pacientes_sync_protocolos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sincronizar_protocolos_paciente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sincronizar_protocolo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_protocolos_paciente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_protocolo(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.relatorio_protocolos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_protocolos() TO authenticated;