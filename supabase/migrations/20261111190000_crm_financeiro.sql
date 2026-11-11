-- Financeiro do Zubler CRM (contrato v2, docs/contrato-financeiro.md no
-- repositório Zubler-CRM): estornos, cancelamento pela equipe e vínculo com
-- o Asaas. Tudo aditivo.
--
--  pagamentos_estornos   cada estorno (total ou parcial) de um pagamento
--                        manual ou de uma cobrança do Asaas
--  asaas_cobrancas       + valor líquido, valor estornado, link da fatura
--  pagamentos_manuais    + valor estornado e status 'estorno_parcial'
--  assinaturas           + quem cancelou, quando, se o cancelamento pode ser
--                        desfeito e a última sincronização com o Asaas

-- ---------------------------------------------------------------------------
-- Cobranças do Asaas
-- ---------------------------------------------------------------------------

alter table public.asaas_cobrancas
  add column if not exists valor_liquido numeric(10, 2),
  add column if not exists valor_estornado numeric(10, 2) not null default 0,
  add column if not exists fatura_url text,
  add column if not exists descricao text;

-- ---------------------------------------------------------------------------
-- Pagamentos manuais: estorno parcial
-- ---------------------------------------------------------------------------

alter table public.pagamentos_manuais
  add column if not exists valor_estornado numeric(10, 2) not null default 0;

alter table public.pagamentos_manuais drop constraint if exists pagamentos_manuais_status_check;
alter table public.pagamentos_manuais
  add constraint pagamentos_manuais_status_check
  check (status in ('pendente', 'confirmado', 'estorno_parcial', 'estornado'));

-- ---------------------------------------------------------------------------
-- Estornos
-- ---------------------------------------------------------------------------

create table if not exists public.pagamentos_estornos (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('manual', 'asaas')),
  -- uuid de pagamentos_manuais ou asaas_payment_id (pay_...)
  pagamento_id text not null,
  medico_id uuid references auth.users(id) on delete set null,
  valor numeric(10, 2) not null check (valor > 0),
  motivo text,
  status text not null default 'solicitado' check (status in ('solicitado', 'concluido', 'falhou')),
  erro text,
  autor text,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);

create index if not exists pagamentos_estornos_pagamento_idx on public.pagamentos_estornos (pagamento_id);
create index if not exists pagamentos_estornos_medico_idx on public.pagamentos_estornos (medico_id);
create index if not exists pagamentos_estornos_criado_em_idx on public.pagamentos_estornos (criado_em desc);

alter table public.pagamentos_estornos enable row level security;
revoke all on public.pagamentos_estornos from anon, authenticated;
grant all on public.pagamentos_estornos to service_role;

-- ---------------------------------------------------------------------------
-- Assinaturas
-- ---------------------------------------------------------------------------

alter table public.assinaturas
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelado_por text,
  -- true quando a equipe agendou pelo CRM (a assinatura do Asaas continua
  -- existindo, só com endDate). O cancelamento da tela Meu plano apaga a
  -- assinatura no Asaas na hora e não pode ser desfeito.
  add column if not exists cancelamento_reversivel boolean not null default false,
  add column if not exists asaas_sincronizado_em timestamptz;
