-- 1) Link público de formulário: a gravação passa a ocorrer só no servidor.
DROP POLICY IF EXISTS "Publico grava itens de resposta" ON public.questionario_resposta_itens;
DROP POLICY IF EXISTS "Publico responde formularios ativos" ON public.questionario_respostas;

REVOKE INSERT, UPDATE, DELETE ON public.questionario_respostas FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.questionario_resposta_itens FROM anon;

DROP FUNCTION IF EXISTS public.resposta_de_formulario_ativo(uuid);

-- 2) Funções SECURITY DEFINER deixam de ser chamáveis pela API:
--    são executadas apenas pelo servidor (service_role), após checar propriedade.
REVOKE EXECUTE ON FUNCTION public.avaliar_resultado_exame(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.avaliar_resultado_tarefa(uuid, jsonb) FROM PUBLIC, anon, authenticated;