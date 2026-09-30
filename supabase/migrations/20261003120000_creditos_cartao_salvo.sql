-- Compra de créditos avulsos com o cartão já cadastrado na assinatura.
--
-- * assinatura_cartoes: token do cartão (creditCardToken do Asaas) usado nas
--   cobranças avulsas "com o cartão cadastrado". Tabela separada e SEM
--   policy de leitura — só service role (rotas /api/assinatura/*) enxerga o
--   token; o navegador só vê bandeira + final em assinaturas.
-- * creditos_adicionais.asaas_payment_id: compra paga direto por cobrança
--   (POST /payments), sem Checkout. O webhook confirma/cancela por esse id.

create table if not exists public.assinatura_cartoes (
  assinatura_id uuid primary key references public.assinaturas(id) on delete cascade,
  credit_card_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.assinatura_cartoes enable row level security;
-- Sem policies: nenhum acesso pelo cliente, nem leitura.

alter table public.creditos_adicionais
  add column if not exists asaas_payment_id text;

create index if not exists creditos_adicionais_asaas_payment_id_idx
  on public.creditos_adicionais (asaas_payment_id);
