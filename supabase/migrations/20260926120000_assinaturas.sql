-- Suporte à tela "Meu plano" (Configurações → Meu plano): gestão da
-- assinatura ATIVA de uma clínica — separado de `contratacoes`, que é só o
-- registro do funil de contratação (ver 20260922150000_contratacoes.sql).
-- Quando um Checkout de assinatura é pago, o webhook (/api/asaas/webhook)
-- cria a linha aqui a partir da contratação correspondente.
--
-- Franquias mensais (medicos/secretarias/copiloto/whatsapp/video) NÃO
-- acumulam — renovam do zero a cada ciclo. `creditos_adicionais` é o único
-- saldo que persiste entre meses (comprado avulso, consumido só depois que
-- a franquia mensal se esgota). `registrar_consumo` implementa essa ordem
-- de prioridade; ainda não é chamada em nenhum lugar do app (ver aviso na
-- resposta) — fica pronta pra quando o uso de Copiloto/WhatsApp/Vídeo
-- passar a ser efetivamente contado.

create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  medico_id uuid not null references auth.users(id) on delete cascade,
  contratacao_id uuid references public.contratacoes(id) on delete set null,

  plano text not null check (plano in ('basic', 'pro', 'enterprise')),
  medicos int not null check (medicos >= 0),
  secretarias int not null check (secretarias >= 0),
  copiloto int not null,
  whatsapp int not null,
  video int not null,
  ciclo text not null check (ciclo in ('mensal', 'anual')),
  dia_cobranca int check (dia_cobranca between 1 and 28),
  preco_mensal numeric(10, 2) not null,

  status text not null default 'ativa' check (status in ('ativa', 'inadimplente', 'cancelada')),
  asaas_customer_id text,
  asaas_subscription_id text,
  -- {"mensagem": "...", "em": "2026-10-05T12:00:00Z"} — null quando não há erro em aberto.
  ultimo_erro_cobranca jsonb,
  proxima_cobranca date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No máximo uma assinatura não-cancelada por médico (evita duas linhas
-- "ativa"/"inadimplente" simultâneas pro mesmo dono — trocar de plano ou
-- voltar a ficar em dia é sempre um UPDATE da mesma linha).
create unique index if not exists assinaturas_medico_id_nao_cancelada_idx
  on public.assinaturas (medico_id)
  where status <> 'cancelada';

create index if not exists assinaturas_asaas_subscription_id_idx on public.assinaturas (asaas_subscription_id);

drop trigger if exists set_updated_at on public.assinaturas;
create trigger set_updated_at
  before update on public.assinaturas
  for each row execute function public.update_updated_at_column();

alter table public.assinaturas enable row level security;
drop policy if exists "dono_le_sua_assinatura" on public.assinaturas;
create policy "dono_le_sua_assinatura"
  on public.assinaturas
  for select
  to authenticated
  using (medico_id = auth.uid());
-- Sem policy de insert/update/delete: só service role (rotas /api/assinatura/*), nunca o cliente direto.

-- ---------------------------------------------------------------------------
-- Créditos adicionais (avulsos, comprados à parte — não expiram no fim do mês)
-- ---------------------------------------------------------------------------

create table if not exists public.creditos_adicionais (
  id uuid primary key default gen_random_uuid(),
  assinatura_id uuid not null references public.assinaturas(id) on delete cascade,
  recurso text not null check (recurso in ('copiloto', 'whatsapp', 'video')),
  quantidade int not null check (quantidade > 0),
  consumido int not null default 0 check (consumido >= 0 and consumido <= quantidade),
  valor_pago numeric(10, 2),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado')),
  asaas_checkout_id text,
  created_at timestamptz not null default now()
);

create index if not exists creditos_adicionais_assinatura_id_idx on public.creditos_adicionais (assinatura_id);
create index if not exists creditos_adicionais_asaas_checkout_id_idx on public.creditos_adicionais (asaas_checkout_id);

alter table public.creditos_adicionais enable row level security;
drop policy if exists "dono_le_seus_creditos" on public.creditos_adicionais;
create policy "dono_le_seus_creditos"
  on public.creditos_adicionais
  for select
  to authenticated
  using (exists (
    select 1 from public.assinaturas a
    where a.id = creditos_adicionais.assinatura_id and a.medico_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Consumo mensal (o quanto já foi usado de cada franquia, no mês corrente)
-- ---------------------------------------------------------------------------

create table if not exists public.consumo_mensal (
  id uuid primary key default gen_random_uuid(),
  assinatura_id uuid not null references public.assinaturas(id) on delete cascade,
  mes date not null, -- sempre o dia 1 do mês (date_trunc('month', ...))
  recurso text not null check (recurso in ('copiloto', 'whatsapp', 'video')),
  usado_plano int not null default 0,
  usado_adicional int not null default 0,
  unique (assinatura_id, mes, recurso)
);

alter table public.consumo_mensal enable row level security;
drop policy if exists "dono_le_seu_consumo" on public.consumo_mensal;
create policy "dono_le_seu_consumo"
  on public.consumo_mensal
  for select
  to authenticated
  using (exists (
    select 1 from public.assinaturas a
    where a.id = consumo_mensal.assinatura_id and a.medico_id = auth.uid()
  ));

-- Registra `p_quantidade` unidades usadas de `p_recurso`, sempre consumindo a
-- franquia mensal do plano primeiro; o excedente cai nos créditos adicionais
-- (mais antigos primeiro). Se nem a franquia nem os adicionais cobrirem tudo,
-- registra o que der e devolve o quanto ficou faltando (negativo = sobrou).
create or replace function public.registrar_consumo(
  p_assinatura_id uuid,
  p_recurso text,
  p_quantidade int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_franquia int;
  v_mes date := date_trunc('month', now())::date;
  v_usado_plano int;
  v_restante int := p_quantidade;
  v_credito record;
  v_usa int;
begin
  select case p_recurso when 'copiloto' then copiloto when 'whatsapp' then whatsapp when 'video' then video end
    into v_franquia
  from public.assinaturas where id = p_assinatura_id;

  insert into public.consumo_mensal (assinatura_id, mes, recurso, usado_plano, usado_adicional)
    values (p_assinatura_id, v_mes, p_recurso, 0, 0)
  on conflict (assinatura_id, mes, recurso) do nothing;

  select usado_plano into v_usado_plano
  from public.consumo_mensal
  where assinatura_id = p_assinatura_id and mes = v_mes and recurso = p_recurso
  for update;

  -- 1) consome a franquia mensal do plano até o limite dela
  v_usa := least(v_restante, greatest(v_franquia - v_usado_plano, 0));
  if v_usa > 0 then
    update public.consumo_mensal set usado_plano = usado_plano + v_usa
    where assinatura_id = p_assinatura_id and mes = v_mes and recurso = p_recurso;
    v_restante := v_restante - v_usa;
  end if;

  -- 2) o que sobrar, consome dos créditos adicionais, do mais antigo pro mais novo
  if v_restante > 0 then
    for v_credito in
      select id, quantidade, consumido
      from public.creditos_adicionais
      where assinatura_id = p_assinatura_id and recurso = p_recurso and status = 'pago' and consumido < quantidade
      order by created_at asc
      for update
    loop
      exit when v_restante <= 0;
      v_usa := least(v_restante, v_credito.quantidade - v_credito.consumido);
      update public.creditos_adicionais set consumido = consumido + v_usa where id = v_credito.id;
      update public.consumo_mensal set usado_adicional = usado_adicional + v_usa
        where assinatura_id = p_assinatura_id and mes = v_mes and recurso = p_recurso;
      v_restante := v_restante - v_usa;
    end loop;
  end if;

  return v_restante; -- > 0 = não coube nem na franquia nem nos adicionais
end;
$$;
