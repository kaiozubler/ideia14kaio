CREATE OR REPLACE FUNCTION public.relatorio_protocolos()
RETURNS TABLE(
  id uuid, paciente_id uuid, patient text, age integer, cid text,
  protocol text, protocolo_id uuid, action text, action_type text,
  doctor text, specialty text, due date, status text,
  notice_type text, notice_desc text, late boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT t.id, t.paciente_id, pa.name,
         CASE WHEN pa.data_nascimento IS NULL THEN NULL
              ELSE EXTRACT(YEAR FROM age(pa.data_nascimento))::int END,
         COALESCE(pp.cid_code, ''),
         pr.titulo, pr.id, ac.nome, ac.tipo,
         COALESCE(pa.medico, ''), COALESCE(ac.especialidade, ''),
         t.due_date, t.status, t.notice_type,
         COALESCE(t.notice_desc, 'Nenhum aviso enviado'),
         (t.due_date < current_date AND t.status IN ('nao_avisado','avisado'))
  FROM public.protocolo_tarefas t
  JOIN public.paciente_protocolos pp ON pp.id = t.paciente_protocolo_id
  JOIN public.protocolos pr ON pr.id = t.protocolo_id
  JOIN public.protocolo_acoes ac ON ac.id = t.acao_id
  JOIN public.pacientes pa ON pa.paciente_id = t.paciente_id
  WHERE t.user_id = auth.uid()
    AND pp.ativo = true
  ORDER BY t.due_date;
$fn$;
REVOKE ALL ON FUNCTION public.relatorio_protocolos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_protocolos() TO authenticated;