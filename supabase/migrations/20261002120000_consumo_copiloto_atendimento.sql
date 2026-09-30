-- Consumo de Copiloto: cada atendimento FINALIZADO conta 1 crédito.
--
-- "Finalizado" = linha de public.consulta com acao = 'Consulta' e ended_at
-- preenchido — é o que saveAtendInternal({finalize:true}) grava em
-- medicopilot.html. Rascunhos (acao = 'Rascunho', autosave) e receitas
-- avulsas (acao = 'Receita') não contam.
--
-- Feito por trigger (e não no front) pra valer para qualquer tela/cliente
-- que finalize um atendimento. Cada consulta é contada no máximo uma vez
-- (consumo_registros.referencia é único por recurso), então re-salvar um
-- atendimento já finalizado não cobra de novo.
--
-- O débito segue registrar_consumo(): franquia do mês primeiro, depois
-- créditos extras. Se nada cobrir, o atendimento é salvo normalmente e o
-- que faltou fica em consumo_registros.excedente (sem bloqueio, por ora).
-- Nenhuma falha aqui pode impedir o salvamento do atendimento.

create table if not exists public.consumo_registros (
  id uuid primary key default gen_random_uuid(),
  assinatura_id uuid not null references public.assinaturas(id) on delete cascade,
  recurso text not null check (recurso in ('copiloto', 'whatsapp', 'video')),
  referencia text not null, -- ex.: 'consulta:<uuid>'
  quantidade int not null default 1 check (quantidade > 0),
  excedente int not null default 0 check (excedente >= 0),
  created_at timestamptz not null default now(),
  unique (recurso, referencia)
);

create index if not exists consumo_registros_assinatura_id_idx
  on public.consumo_registros (assinatura_id, created_at desc);

alter table public.consumo_registros enable row level security;
drop policy if exists "dono_le_seus_registros_consumo" on public.consumo_registros;
create policy "dono_le_seus_registros_consumo"
  on public.consumo_registros
  for select
  to authenticated
  using (exists (
    select 1 from public.assinaturas a
    where a.id = consumo_registros.assinatura_id and a.medico_id = auth.uid()
  ));
-- Sem policy de escrita: só a trigger abaixo (security definer) grava aqui.

create or replace function public.contar_copiloto_atendimento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assinatura_id uuid;
  v_registro_id uuid;
  v_faltou int;
begin
  begin
    select id into v_assinatura_id
    from public.assinaturas
    where medico_id = new.id_medico and status <> 'cancelada'
    limit 1;

    -- Plano Free (sem assinatura): nada a debitar.
    if v_assinatura_id is null then
      return new;
    end if;

    insert into public.consumo_registros (assinatura_id, recurso, referencia, quantidade)
    values (v_assinatura_id, 'copiloto', 'consulta:' || new.id, 1)
    on conflict (recurso, referencia) do nothing
    returning id into v_registro_id;

    -- Já contado antes (re-salvamento do mesmo atendimento).
    if v_registro_id is null then
      return new;
    end if;

    v_faltou := public.registrar_consumo(v_assinatura_id, 'copiloto', 1);
    if v_faltou > 0 then
      update public.consumo_registros set excedente = v_faltou where id = v_registro_id;
    end if;
  exception when others then
    raise warning 'contar_copiloto_atendimento falhou para consulta %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists contar_copiloto_atendimento on public.consulta;
create trigger contar_copiloto_atendimento
  after insert or update of acao, ended_at on public.consulta
  for each row
  when (new.acao = 'Consulta' and new.ended_at is not null)
  execute function public.contar_copiloto_atendimento();

-- registrar_consumo é interna: só a trigger (e o service role) chamam.
revoke all on function public.registrar_consumo(uuid, text, int) from public, anon, authenticated;
revoke all on function public.contar_copiloto_atendimento() from public, anon, authenticated;
