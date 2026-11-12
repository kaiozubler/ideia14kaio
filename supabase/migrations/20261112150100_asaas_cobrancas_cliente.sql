-- Cobranças do Asaas sem clínica: compras avulsas de créditos (sem
-- assinatura) e cobranças que chegam antes de a contratação ser ativada.
-- Guarda o cliente do Asaas para ligar essas cobranças depois (webhook,
-- ativação e sincronização do CRM) e já liga as que dá pela assinatura.

alter table public.asaas_cobrancas add column if not exists asaas_customer_id text;
create index if not exists asaas_cobrancas_customer_idx on public.asaas_cobrancas (asaas_customer_id);
create index if not exists asaas_cobrancas_subscription_idx on public.asaas_cobrancas (asaas_subscription_id);

update public.asaas_cobrancas c
   set medico_id = a.medico_id,
       assinatura_id = a.id
  from public.assinaturas a
 where c.medico_id is null
   and c.asaas_subscription_id is not null
   and a.asaas_subscription_id = c.asaas_subscription_id;
