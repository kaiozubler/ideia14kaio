-- Tela "Meu plano" v2: controle geral de pagamentos da assinatura.
--
-- * Downgrade agendado: trocar pra um plano mais barato não tira a franquia
--   já paga no meio do ciclo — o plano novo só entra na próxima cobrança
--   (plano_agendado / plano_agendado_para). Upgrade continua imediato.
-- * Cancelamento no fim do período: cancelar interrompe as cobranças no
--   Asaas na hora, mas o acesso continua até cancelamento_agendado_para
--   (a data da próxima cobrança que não vai mais acontecer).
-- * Cartão: só bandeira + 4 últimos dígitos, pra exibição. Número/CVV
--   nunca são gravados — vão direto pro Asaas (/api/assinatura/atualizar-cartao).

alter table public.assinaturas
  add column if not exists plano_agendado text check (plano_agendado in ('basic', 'pro', 'enterprise')),
  add column if not exists plano_agendado_para date,
  add column if not exists cancelamento_agendado_para date,
  add column if not exists cancelamento_solicitado_em timestamptz,
  add column if not exists cancelamento_motivo text,
  add column if not exists cartao_bandeira text,
  add column if not exists cartao_final text;

-- Aplica, pra assinatura de quem chamou, o que estava agendado e já venceu:
-- downgrade cuja data chegou e cancelamento cujo período pago acabou. Não
-- existe cron neste projeto, então é "preguiçoso": chamado pela tela Meu
-- plano e pelo plano-gate.js antes de lerem a assinatura. Os números do
-- plano agendado são uma cópia de PLANOS_BASE (src/lib/plans/config.ts) —
-- se mudar lá, replique aqui.
create or replace function public.aplicar_agendamentos_assinatura()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  update public.assinaturas
     set status = 'cancelada'
   where medico_id = v_uid
     and status <> 'cancelada'
     and cancelamento_agendado_para is not null
     and cancelamento_agendado_para <= current_date;

  update public.assinaturas a
     set plano = p.plano,
         medicos = p.medicos,
         secretarias = p.secretarias,
         copiloto = p.copiloto,
         whatsapp = p.whatsapp,
         video = p.video,
         preco_mensal = p.preco_mensal,
         plano_agendado = null,
         plano_agendado_para = null
    from (values
      ('basic', 1, 1, 60, 500, 0, 149.90::numeric),
      ('pro', 1, 1, 200, 2000, 3000, 249.90::numeric),
      ('enterprise', 2, 2, 500, 5000, 10000, 649.90::numeric)
    ) as p(plano, medicos, secretarias, copiloto, whatsapp, video, preco_mensal)
   where a.medico_id = v_uid
     and a.status <> 'cancelada'
     and a.plano_agendado = p.plano
     and a.plano_agendado_para is not null
     and a.plano_agendado_para <= current_date;
end;
$$;

revoke all on function public.aplicar_agendamentos_assinatura() from public;
grant execute on function public.aplicar_agendamentos_assinatura() to authenticated;
