-- Faturamento por trabalho, cliente, NF e recebimento. Documentacao em public/faturamento.js e AGENTS.md

CREATE TABLE IF NOT EXISTS public.faturamento_clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo_pessoa text not null default 'PJ' check (tipo_pessoa in ('PF', 'PJ')),
  nome text not null check (length(nome) between 1 and 200),
  nome_fantasia text,
  documento text,
  inscricao_municipal text,
  inscricao_estadual text,
  email text,
  telefone text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  codigo_municipio text,
  iss_retido boolean not null default false,
  emissao_nf text not null default 'cada_servico' check (emissao_nf in ('cada_servico', 'quinzenal', 'mensal', 'autorizacao', 'sem_emissao')),
  meio_pagamento text,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS faturamento_clientes_user_idx ON public.faturamento_clientes (user_id, nome);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faturamento_clientes TO authenticated;

GRANT ALL ON public.faturamento_clientes TO service_role;

ALTER TABLE public.faturamento_clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario gerencia seus clientes de faturamento" ON public.faturamento_clientes;

CREATE POLICY "Usuario gerencia seus clientes de faturamento" ON public.faturamento_clientes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_faturamento_clientes_updated ON public.faturamento_clientes;

CREATE TRIGGER trg_faturamento_clientes_updated BEFORE UPDATE ON public.faturamento_clientes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.faturamento_servicos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cliente_id uuid not null references public.faturamento_clientes(id) on delete restrict,
  modalidade text not null default 'avulso' check (modalidade in ('avulso', 'frequente')),
  tipo_servico text not null default 'Outros',
  descricao text,
  valor_bruto numeric(14,2) not null default 0,
  valor_nf numeric(14,2) not null default 0,
  emissao_nf text not null default 'cada_servico' check (emissao_nf in ('cada_servico', 'quinzenal', 'mensal', 'autorizacao', 'sem_emissao')),
  agrupamento text not null default 'por_servico' check (agrupamento in ('por_servico', 'quinzenal', 'mensal')),
  observacao_nf text,
  meio_pagamento text,
  data_servico date,
  data_pagamento date,
  frequencia text check (frequencia in ('semanal', 'mensal')),
  intervalo_semanas integer not null default 1 check (intervalo_semanas between 1 and 4),
  dias_semana integer[] not null default '{}'::integer[],
  dias_mes integer[] not null default '{}'::integer[],
  data_inicio date,
  data_fim date,
  pagamento_regra text not null default 'dias_apos' check (pagamento_regra in ('dias_apos', 'dia_fixo')),
  pagamento_dias integer not null default 0 check (pagamento_dias between 0 and 365),
  pagamento_dia_mes integer check (pagamento_dia_mes between 1 and 31),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS faturamento_servicos_user_idx ON public.faturamento_servicos (user_id, modalidade, ativo);

CREATE INDEX IF NOT EXISTS faturamento_servicos_cliente_idx ON public.faturamento_servicos (cliente_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faturamento_servicos TO authenticated;

GRANT ALL ON public.faturamento_servicos TO service_role;

ALTER TABLE public.faturamento_servicos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario gerencia seus servicos de faturamento" ON public.faturamento_servicos;

CREATE POLICY "Usuario gerencia seus servicos de faturamento" ON public.faturamento_servicos FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_faturamento_servicos_updated ON public.faturamento_servicos;

CREATE TRIGGER trg_faturamento_servicos_updated BEFORE UPDATE ON public.faturamento_servicos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.faturamento_notas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cliente_id uuid references public.faturamento_clientes(id) on delete set null,
  paciente_id uuid references public.pacientes(paciente_id) on delete set null,
  tomador_nome text,
  numero integer,
  serie text not null default '1',
  status text not null default 'pendente' check (status in ('pendente', 'aguardando_autorizacao', 'emitida', 'cancelada')),
  modo text,
  competencia_inicio date,
  competencia_fim date,
  valor numeric(14,2) not null default 0,
  descricao text,
  observacao text,
  emitida_em timestamptz,
  autorizada_em timestamptz,
  cancelada_em timestamptz,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS faturamento_notas_numero_uidx ON public.faturamento_notas (user_id, serie, numero);

CREATE INDEX IF NOT EXISTS faturamento_notas_user_idx ON public.faturamento_notas (user_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faturamento_notas TO authenticated;

GRANT ALL ON public.faturamento_notas TO service_role;

ALTER TABLE public.faturamento_notas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario gerencia suas notas fiscais" ON public.faturamento_notas;

CREATE POLICY "Usuario gerencia suas notas fiscais" ON public.faturamento_notas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_faturamento_notas_updated ON public.faturamento_notas;

CREATE TRIGGER trg_faturamento_notas_updated BEFORE UPDATE ON public.faturamento_notas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS origem text;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS cliente_id uuid references public.faturamento_clientes(id) on delete set null;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS servico_id uuid references public.faturamento_servicos(id) on delete set null;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS nota_id uuid references public.faturamento_notas(id) on delete set null;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS tipo_servico text;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS competencia_inicio date;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS competencia_fim date;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS valor_nf numeric(14,2);

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS observacao_nf text;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS nf_modo text;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS meio_pagamento text;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS data_pagamento date;

ALTER TABLE public.lancamentos_financeiros ADD COLUMN IF NOT EXISTS editado boolean not null default false;

CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_financeiros_servico_competencia_uidx ON public.lancamentos_financeiros (servico_id, competencia_inicio);

CREATE INDEX IF NOT EXISTS lancamentos_financeiros_cliente_idx ON public.lancamentos_financeiros (cliente_id, vencimento);

CREATE INDEX IF NOT EXISTS lancamentos_financeiros_nota_idx ON public.lancamentos_financeiros (nota_id);

CREATE TABLE IF NOT EXISTS public.faturamento_execucoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  servico_id uuid not null references public.faturamento_servicos(id) on delete cascade,
  lancamento_id uuid references public.lancamentos_financeiros(id) on delete cascade,
  data date not null,
  valor_bruto numeric(14,2) not null default 0,
  valor_nf numeric(14,2) not null default 0,
  status text not null default 'previsto' check (status in ('previsto', 'realizado', 'cancelado')),
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS faturamento_execucoes_servico_data_uidx ON public.faturamento_execucoes (servico_id, data);

CREATE INDEX IF NOT EXISTS faturamento_execucoes_user_idx ON public.faturamento_execucoes (user_id, data);

CREATE INDEX IF NOT EXISTS faturamento_execucoes_lancamento_idx ON public.faturamento_execucoes (lancamento_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faturamento_execucoes TO authenticated;

GRANT ALL ON public.faturamento_execucoes TO service_role;

ALTER TABLE public.faturamento_execucoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario gerencia suas execucoes de servico" ON public.faturamento_execucoes;

CREATE POLICY "Usuario gerencia suas execucoes de servico" ON public.faturamento_execucoes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_faturamento_execucoes_updated ON public.faturamento_execucoes;

CREATE TRIGGER trg_faturamento_execucoes_updated BEFORE UPDATE ON public.faturamento_execucoes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
