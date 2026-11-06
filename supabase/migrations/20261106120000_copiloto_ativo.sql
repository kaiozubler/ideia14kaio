-- Copiloto ativo: a IA acompanha a consulta e traz sugestões sozinha a cada
-- ciclo (chamadas automáticas a /api/chat-ia). Incluído no plano Pro,
-- adicional opcional no Enterprise (cobrado por consulta da franquia de
-- Copiloto, ver src/lib/plans/config.ts) e fora do Basic, que fica reativo.
--
-- O direito vale por plano + esta coluna (copilotoAtivoLiberado no código):
-- só no Enterprise a coluna decide; no Pro é sempre verdadeiro.

alter table public.contratacoes
  add column if not exists copiloto_ativo boolean not null default false;

alter table public.assinaturas
  add column if not exists copiloto_ativo boolean not null default false;

-- Pro inclui. Enterprise que já existia mantém o modo ativo (decisão de
-- produto em 2026-11-06); novas contratações Enterprise escolhem o adicional.
update public.assinaturas
   set copiloto_ativo = true
 where plano in ('pro', 'enterprise')
   and copiloto_ativo = false;

-- Downgrade agendado (só para Basic ou Pro: o Enterprise vale na hora, ver
-- /api/assinatura/trocar-plano) também acerta o Copiloto ativo do destino:
-- Pro inclui, Basic não tem.
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
         copiloto_ativo = p.copiloto_ativo,
         plano_agendado = null,
         plano_agendado_para = null
    from (values
      ('basic', 1, 1, 60, 500, 0, 149.90::numeric, false),
      ('pro', 1, 1, 200, 2000, 3000, 249.90::numeric, true),
      ('enterprise', 2, 2, 500, 5000, 10000, 649.90::numeric, false)
    ) as p(plano, medicos, secretarias, copiloto, whatsapp, video, preco_mensal, copiloto_ativo)
   where a.medico_id = v_uid
     and a.status <> 'cancelada'
     and a.plano_agendado = p.plano
     and a.plano_agendado_para is not null
     and a.plano_agendado_para <= current_date;
end;
$$;

revoke all on function public.aplicar_agendamentos_assinatura() from public;
grant execute on function public.aplicar_agendamentos_assinatura() to authenticated;
