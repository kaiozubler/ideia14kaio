-- Tabelas para a tela de Questionário (formulários enviados a pacientes)
-- Ajuste nomes de FK (ex.: clinica_id, medico_id) conforme o multi-tenant já usado
-- nas outras tabelas do projeto (ex.: "pacientes").

create table if not exists public.questionarios (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  anonimo boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.questionario_perguntas (
  id uuid primary key default gen_random_uuid(),
  questionario_id uuid not null references public.questionarios(id) on delete cascade,
  ordem int not null default 0,
  tipo text not null check (tipo in ('texto','unica','multipla','escala')),
  enunciado text not null,
  opcoes jsonb,               -- array de strings, usado em 'unica'/'multipla'
  escala_min int,              -- usado em 'escala'
  escala_max int,
  escala_label_min text,
  escala_label_max text,
  obrigatoria boolean not null default true
);

create table if not exists public.questionario_respostas (
  id uuid primary key default gen_random_uuid(),
  questionario_id uuid not null references public.questionarios(id) on delete cascade,
  paciente_id uuid references public.pacientes(paciente_id),
  paciente_nome text,
  paciente_telefone text,
  paciente_email text,
  paciente_cpf text,
  respondido_em timestamptz not null default now()
);

create table if not exists public.questionario_resposta_itens (
  id uuid primary key default gen_random_uuid(),
  resposta_id uuid not null references public.questionario_respostas(id) on delete cascade,
  pergunta_id uuid not null references public.questionario_perguntas(id) on delete cascade,
  valor_texto text,
  valor_opcoes jsonb,          -- array de strings selecionadas ('unica'/'multipla')
  valor_escala int
);

-- registro de envios/compartilhamentos (usado pelos botões "Compartilhar")
create table if not exists public.questionario_envios (
  id uuid primary key default gen_random_uuid(),
  questionario_id uuid not null references public.questionarios(id) on delete cascade,
  paciente_id uuid references public.pacientes(paciente_id),
  enviado_em timestamptz not null default now()
);

create index if not exists idx_qz_perguntas_form on public.questionario_perguntas(questionario_id);
create index if not exists idx_qz_respostas_form on public.questionario_respostas(questionario_id);
create index if not exists idx_qz_resposta_itens_resposta on public.questionario_resposta_itens(resposta_id);
create index if not exists idx_qz_envios_form on public.questionario_envios(questionario_id);

-- RLS: habilite e replique as policies já usadas em "protocolos"/"pacientes"
-- neste projeto (provavelmente algo como "usuários autenticados da clínica").
alter table public.questionarios enable row level security;
alter table public.questionario_perguntas enable row level security;
alter table public.questionario_respostas enable row level security;
alter table public.questionario_resposta_itens enable row level security;
alter table public.questionario_envios enable row level security;

-- A tabela questionario_respostas também precisa de uma policy de INSERT
-- para o público anônimo (a página pública que você vai construir no Lovable
-- grava a resposta sem estar autenticada como médico/clínica). Exemplo:
-- create policy "publico pode responder" on public.questionario_respostas
--   for insert to anon with check (true);
-- create policy "publico pode inserir itens" on public.questionario_resposta_itens
--   for insert to anon with check (true);
-- Restrinja isso com mais cuidado antes de ir para produção (ex.: validar
-- que o questionario_id referenciado está com ativo = true).
