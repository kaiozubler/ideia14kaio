-- Cupons de desconto da contratação, criados no Zubler CRM pela ponte
-- (/api/public/crm/cupons). Regras e cálculo em src/lib/cupons/regras.ts.
--
--  codigo         nome do cupom = o que o cliente digita; único sem
--                 diferenciar maiúsculas (gravado sempre em maiúsculo)
--  tipo           percentual | valor | teste_gratis | recurso_adicional
--  valor          % / R$ / dias de teste / quantidade adicional por mês
--  recurso        só no recurso_adicional: copiloto, whatsapp, video,
--                 medicos, secretarias ou copiloto_ativo
--  planos         planos onde vale; vazio = qualquer plano
--  ciclo          mensal ou anual; null = qualquer
--  duracao_meses  mensalidades com o benefício; null = vitalício
--  valido_de/ate  janela em que o cupom pode ser usado na contratação
--  limite_usos    null = sem limite
--
-- Cupom nunca é apagado: desativar só troca `ativo`.

create table if not exists public.cupons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null check (codigo = upper(codigo) and codigo ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  descricao text,
  tipo text not null check (tipo in ('percentual', 'valor', 'teste_gratis', 'recurso_adicional')),
  valor numeric(12, 2) not null check (valor > 0),
  recurso text check (recurso in ('copiloto', 'whatsapp', 'video', 'medicos', 'secretarias', 'copiloto_ativo')),
  planos text[] not null default '{}' check (planos <@ array['basic', 'pro', 'enterprise']),
  ciclo text check (ciclo in ('mensal', 'anual')),
  duracao_meses int check (duracao_meses between 1 and 120),
  valido_de date,
  valido_ate date,
  limite_usos int check (limite_usos > 0),
  ativo boolean not null default true,
  criado_por text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tipo <> 'percentual' or valor <= 100),
  check ((tipo = 'recurso_adicional') = (recurso is not null)),
  check (valido_ate is null or valido_de is null or valido_ate >= valido_de)
);

create unique index if not exists cupons_codigo_unico on public.cupons (upper(codigo));

alter table public.cupons enable row level security;
-- Sem policy: só o servidor (service_role) lê e grava.
revoke all on public.cupons from anon, authenticated;
grant all on public.cupons to service_role;

-- Qual cupom a contratação usou (conta os usos do cupom).
alter table public.contratacoes
  add column if not exists cupom_id uuid references public.cupons(id) on delete set null;
create index if not exists contratacoes_cupom_id_idx on public.contratacoes (cupom_id);
