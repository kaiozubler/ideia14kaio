-- Colunas pra rastrear a integração com o Checkout Asaas
-- (https://docs.asaas.com/docs/checkout-asaas) na tabela contratacoes
-- (ver 20260922150000_contratacoes.sql).
--
-- Fluxo: criamos um Checkout Asaas com chargeTypes=RECURRENT (assinatura)
-- a partir do pedido já confirmado; guardamos o id do Checkout aqui pra
-- conseguir casar o webhook (CHECKOUT_PAID/CANCELED/EXPIRED) de volta com
-- a linha certa. asaas_subscription_id só é preenchido depois, quando o
-- Asaas efetivamente cria a assinatura (evento SUBSCRIPTION_CREATED).

alter table public.contratacoes
  add column if not exists asaas_checkout_id text,
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists cidade_ibge text;

create index if not exists contratacoes_asaas_checkout_id_idx on public.contratacoes (asaas_checkout_id);
