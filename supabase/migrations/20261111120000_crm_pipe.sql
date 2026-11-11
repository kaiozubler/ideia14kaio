-- Posição de cada cliente na Pipe do Zubler CRM (/api/public/crm/pipe).
--
-- O card é montado com dados reais do app (conta do médico, assinatura,
-- pagamentos, contratação); aqui fica só o que a equipe decide no CRM:
--
--  tipo         clinica (conta do médico dono) ou contratacao (lead que
--               começou a contratação e ainda não tem conta ativada)
--  ref_id       id da clínica (auth.users.id) ou da contratação
--  funil/etapa  onde a equipe colocou o card; vazio = posição automática
--  responsavel  e-mail de quem da equipe Zubler cuida do cliente
--  lost         cancelamento marcado no CRM: motivo, data, multa, boletos,
--               valor em aberto e observações
--
-- Sem linha = card na posição automática (ver src/lib/crm/pipe.ts).

create table if not exists public.crm_pipe (
  tipo text not null check (tipo in ('clinica', 'contratacao')),
  ref_id uuid not null,
  funil text check (funil in ('leads', 'onboarding', 'ongoing')),
  etapa text,
  responsavel text,
  lost jsonb,
  atualizado_por text not null,
  atualizado_em timestamptz not null default now(),
  primary key (tipo, ref_id),
  check ((funil is null) = (etapa is null))
);

alter table public.crm_pipe enable row level security;
-- Sem policy: só o servidor (service_role) lê e grava.
revoke all on public.crm_pipe from anon, authenticated;
grant all on public.crm_pipe to service_role;
