-- Cancelamento e troca de plano agendados passam a valer sem depender do
-- login do cliente. Antes, aplicar_agendamentos_assinatura() só rodava pelo
-- navegador de quem estava logado (tela Meu plano / plano-gate), e quem
-- cancelou e nunca mais entrou continuava 'ativa' para sempre.
--
--  aplicar_agendamentos_assinaturas(p_medico_id)  aplica para uma clínica ou,
--      com null, para todas. Só service_role (ponte do CRM, webhook do Asaas e
--      o agendamento diário abaixo).
--  aplicar_agendamentos_assinatura()  continua para o navegador, agora
--      chamando a de cima com o próprio login.
--
-- O dia é o de Brasília.

create or replace function public.aplicar_agendamentos_assinaturas(p_medico_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_canceladas int;
  v_trocas int;
begin
  update public.assinaturas
     set status = 'cancelada',
         cancelada_em = coalesce(cancelada_em, cancelamento_agendado_para::timestamp at time zone 'America/Sao_Paulo')
   where (p_medico_id is null or medico_id = p_medico_id)
     and status <> 'cancelada'
     and cancelamento_agendado_para is not null
     and cancelamento_agendado_para <= v_hoje;
  get diagnostics v_canceladas = row_count;

  -- Mesma tabela de planos de 20261106120000_copiloto_ativo (e de public/meu-plano.js).
  update public.assinaturas a
     set plano = p.plano,
         medicos = p.medicos,
         secretarias = p.secretarias,
         copiloto = p.copiloto,
         whatsapp = p.whatsapp,
         video = p.video,
         preco_mensal = p.preco_mensal,
         copiloto_ativo = p.copiloto_ativo,
         plano_agendado = null,
         plano_agendado_para = null
    from (values
      ('basic', 1, 1, 60, 500, 0, 149.90::numeric, false),
      ('pro', 1, 1, 200, 2000, 3000, 249.90::numeric, true),
      ('enterprise', 2, 2, 500, 5000, 10000, 649.90::numeric, false)
    ) as p(plano, medicos, secretarias, copiloto, whatsapp, video, preco_mensal, copiloto_ativo)
   where (p_medico_id is null or a.medico_id = p_medico_id)
     and a.status <> 'cancelada'
     and a.plano_agendado = p.plano
     and a.plano_agendado_para is not null
     and a.plano_agendado_para <= v_hoje;
  get diagnostics v_trocas = row_count;

  return v_canceladas + v_trocas;
end;
$$;

revoke all on function public.aplicar_agendamentos_assinaturas(uuid) from public, anon, authenticated;
grant execute on function public.aplicar_agendamentos_assinaturas(uuid) to service_role;

create or replace function public.aplicar_agendamentos_assinatura()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  perform public.aplicar_agendamentos_assinaturas(auth.uid());
end;
$$;

-- Uma vez por dia (00:05 em Brasília), se o pg_cron estiver ligado no projeto.
-- Sem ele, a ponte do CRM e o webhook do Asaas aplicam a cada chamada.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'aplicar-agendamentos-assinaturas';
    perform cron.schedule(
      'aplicar-agendamentos-assinaturas',
      '5 3 * * *',
      'select public.aplicar_agendamentos_assinaturas(null)'
    );
  end if;
end;
$$;
