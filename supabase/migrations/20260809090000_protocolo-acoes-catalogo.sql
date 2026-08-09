-- Vincula ações de protocolo (Exame/Receita) aos catálogos reais do sistema
-- (tuss_procedimentos e substancias/medicamentos), em vez de depender apenas
-- do texto livre em protocolo_acoes.nome.
--
-- Aditivo: nenhuma coluna existente é removida ou tem seu comportamento
-- alterado. Linhas já existentes ficam com catalogo_status = 'nao_aplicavel'
-- (comportamento idêntico ao atual, sem vínculo).

ALTER TABLE public.protocolo_acoes
  ADD COLUMN tuss_procedimento_id uuid REFERENCES public.tuss_procedimentos(id),
  ADD COLUMN id_substancia uuid REFERENCES public.substancias(id_substancia),
  ADD COLUMN medicamento_id text REFERENCES public.medicamentos(id),
  ADD COLUMN catalogo_status text NOT NULL DEFAULT 'nao_aplicavel'
    CHECK (catalogo_status IN ('vinculado', 'pendente_cadastro', 'nao_aplicavel'));

-- Garante coerência: cada tipo de ação só pode referenciar o catálogo que
-- faz sentido para ele (Exame -> TUSS; Receita -> substância/medicamento;
-- Consulta -> nenhum catálogo).
ALTER TABLE public.protocolo_acoes
  ADD CONSTRAINT chk_protocolo_acoes_catalogo_tipo CHECK (
    (tipo = 'Exame' AND medicamento_id IS NULL AND id_substancia IS NULL)
    OR (tipo = 'Receita' AND tuss_procedimento_id IS NULL)
    OR (tipo = 'Consulta' AND tuss_procedimento_id IS NULL AND medicamento_id IS NULL AND id_substancia IS NULL)
  );

CREATE INDEX idx_protocolo_acoes_tuss ON public.protocolo_acoes(tuss_procedimento_id);
CREATE INDEX idx_protocolo_acoes_substancia ON public.protocolo_acoes(id_substancia);
CREATE INDEX idx_protocolo_acoes_catalogo_status ON public.protocolo_acoes(catalogo_status);

-- relatorio_protocolos ganha os campos de catálogo, para a tela de
-- Protocolos exibir o código TUSS e sinalizar pendências de vínculo sem
-- precisar de outra query.
CREATE OR REPLACE FUNCTION public.relatorio_protocolos()
RETURNS TABLE(
  id uuid, paciente_id uuid, patient text, age integer, cid text,
  protocol text, protocolo_id uuid, action text, action_type text,
  doctor text, specialty text, due date, status text,
  notice_type text, notice_desc text, late boolean,
  codigo_tuss text, catalogo_status text
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
         (t.due_date < current_date AND t.status IN ('nao_avisado','avisado')),
         tp.codigo_tuss, ac.catalogo_status
  FROM public.protocolo_tarefas t
  JOIN public.paciente_protocolos pp ON pp.id = t.paciente_protocolo_id
  JOIN public.protocolos pr ON pr.id = t.protocolo_id
  JOIN public.protocolo_acoes ac ON ac.id = t.acao_id
  LEFT JOIN public.tuss_procedimentos tp ON tp.id = ac.tuss_procedimento_id
  JOIN public.pacientes pa ON pa.paciente_id = t.paciente_id
  WHERE t.user_id = auth.uid()
    AND t.status <> 'ignorado'
    AND pp.ativo = true
  ORDER BY t.due_date;
$fn$;

-- Nota: protocolo_tarefas.resultado_valor (já existente, migration
-- 20260808120000) continua sendo o registro do resultado do exame que
-- disparou/controlou a ramificação — nenhuma mudança necessária ali. O que
-- faltava era apenas a ação-gatilho (protocolo_acoes) saber, via FK, A QUAL
-- exame do catálogo TUSS ela corresponde.
