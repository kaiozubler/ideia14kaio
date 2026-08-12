-- Processos LME (Laudo de Solicitação, Avaliação e Autorização de Medicamentos
-- de alto custo) vinculados ao paciente. Independente de protocolos, mas pode
-- referenciar o protocolo/CID que originou a necessidade do medicamento.
--
-- Prazo de validade: um processo LME vence 6 meses após a data de solicitação
-- (data_solicitacao). data_validade é uma coluna gerada para permitir consultas
-- e ordenação simples ("vencidos", "vencendo em N dias") sem lógica duplicada
-- no client. O status 'vencido' não é setado automaticamente por um cron —
-- o client calcula com base em data_validade < current_date e oferece a
-- ação de "solicitar renovação", que apenas cria um novo processo apontando
-- para o anterior (processo_anterior_id), preservando o histórico.

CREATE TABLE public.lme_processos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  paciente_id uuid NOT NULL REFERENCES public.pacientes(paciente_id) ON DELETE CASCADE,
  paciente_protocolo_id uuid REFERENCES public.paciente_protocolos(id) ON DELETE SET NULL,
  protocolo_id uuid REFERENCES public.protocolos(id) ON DELETE SET NULL,
  processo_anterior_id uuid REFERENCES public.lme_processos(id) ON DELETE SET NULL,

  medicamento_id uuid REFERENCES public.medicamentos(id) ON DELETE SET NULL,
  medicamento_nome text NOT NULL,
  cid_code text,

  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','protocolado','em_analise','deferido','indeferido','renovacao_solicitada')),
  numero_processo text,
  orgao text, -- ex.: "SUS", nome da operadora/convênio

  data_solicitacao date NOT NULL DEFAULT current_date,
  data_validade date GENERATED ALWAYS AS ((data_solicitacao + interval '6 months')::date) STORED,

  documentos jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- cada item referencia uma linha já existente em public.documentos_paciente
  -- (mesma tabela/bucket "documentos-arquivos" usados pelo resto do app para
  -- laudos, receitas etc. — não duplicamos o mecanismo de armazenamento):
  --   {documento_paciente_id, nome, origem: 'anexo'|'gerado'|'importado', criado_em}

  observacoes text,
  ativo boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lme_processos TO authenticated;
GRANT ALL ON public.lme_processos TO service_role;
ALTER TABLE public.lme_processos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicos gerenciam processos LME de seus pacientes" ON public.lme_processos FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_lme_processos_updated BEFORE UPDATE ON public.lme_processos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_lme_processos_paciente ON public.lme_processos(paciente_id);
CREATE INDEX idx_lme_processos_validade ON public.lme_processos(data_validade);
CREATE INDEX idx_lme_processos_protocolo ON public.lme_processos(protocolo_id);

-- Nota: documentos anexados/gerados/importados para um processo LME usam a
-- tabela public.documentos_paciente e o bucket "documentos-arquivos" que já
-- existem no projeto (mesmo mecanismo usado por salvarDocumentoGerado() no
-- client para laudos e receitas). lme_processos.documentos guarda apenas
-- referências leves (documento_paciente_id) para essas linhas.
