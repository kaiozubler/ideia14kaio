-- Tabela que passa a guardar de verdade o que hoje só fica no sessionStorage
-- do navegador durante o fluxo /planos → /contratacao/confirmar → /dados →
-- /termos → /pagamento → /conclusao (ver src/lib/contratacao/pedido.ts).
--
-- Guarda CPF/CNPJ, endereço e contatos (dados pessoais), então o acesso é
-- fechado por padrão (RLS ligado, ZERO policies para anon/authenticated).
-- Toda leitura e escrita passa por uma rota de servidor usando o service
-- role (supabaseAdmin), igual o resto do app já faz para dado sensível —
-- nunca deve ser lida/gravada direto do navegador com a anon key.
--
-- `status` acompanha o avanço pela régua de etapas — útil pra saber quantas
-- pessoas abandonam em cada passo:
--   em_andamento          -> ainda preenchendo (criada em "Confirme seu plano")
--   aguardando_confirmacao -> chegou no fim do fluxo, falou com o time no
--                             WhatsApp, aguardando confirmação manual do
--                             pagamento (não existe cobrança automática ainda)
--   confirmada            -> pagamento confirmado, conta deve ser ativada
--   cancelada             -> desistiu ou foi descartada

create table if not exists public.contratacoes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'aguardando_confirmacao', 'confirmada', 'cancelada')),

  -- Plano + configuração (mesmo shape de ConfiguracaoPlano; copiloto/whatsapp/video
  -- podem ser -1, que é o sentinel de "Personalizado" — ver PERSONALIZADO em
  -- src/lib/plans/config.ts)
  plano text not null check (plano in ('basic', 'pro', 'enterprise')),
  medicos int not null check (medicos >= 0),
  secretarias int not null check (secretarias >= 0),
  copiloto int not null,
  whatsapp int not null,
  video int not null,
  ciclo text not null check (ciclo in ('mensal', 'anual')),
  dia_cobranca int check (dia_cobranca between 1 and 28),
  preco_mensal_calculado numeric(10, 2),

  -- Dados da clínica
  nome_clinica text,
  documento text, -- CPF ou CNPJ, com máscara, como digitado

  -- Endereço
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  estado text,

  -- Responsável principal
  responsavel_nome text,
  responsavel_email text,
  responsavel_telefone text,
  responsavel_cargo text,

  -- Financeiro (recebe NF/cobrança) — se "mesmo_responsavel" for true, o array
  -- fica vazio e o contato vale é o responsável principal acima.
  financeiro_mesmo_responsavel boolean not null default true,
  financeiro jsonb not null default '[]'::jsonb, -- Contato[]: [{nome,email,telefone}]

  -- Jurídico (recebe o termo/contrato para assinatura) — mesma lógica do financeiro.
  juridico_mesmo_responsavel boolean not null default true,
  juridico jsonb not null default '[]'::jsonb, -- Contato[]

  -- Perfil / estatística da clínica
  especialidade text,
  pacientes_mes text,
  como_conheceu text,

  -- Termo de uso
  termos_aceitos boolean not null default false,
  termos_aceitos_em timestamptz,

  -- Preenchido manualmente pelo time comercial quando confirmar o pagamento
  -- (não existe gateway de cobrança automática plugado ainda).
  pagamento_confirmado_em timestamptz,

  -- Só é preenchido se, no futuro, esse fluxo passar a ser usado por alguém
  -- já logado no app (hoje o fluxo público não exige login).
  user_id uuid references auth.users(id) on delete set null
);

create index if not exists contratacoes_status_idx on public.contratacoes (status);
create index if not exists contratacoes_plano_idx on public.contratacoes (plano);
create index if not exists contratacoes_created_at_idx on public.contratacoes (created_at desc);
create index if not exists contratacoes_documento_idx on public.contratacoes (documento);

-- Reaproveita o trigger de updated_at que o projeto já usa em outras tabelas.
drop trigger if exists set_updated_at on public.contratacoes;
create trigger set_updated_at
  before update on public.contratacoes
  for each row execute function public.update_updated_at_column();

alter table public.contratacoes enable row level security;
-- Nenhuma policy de propósito: nem anon nem authenticated têm select/insert/
-- update/delete direto. Tudo passa pela rota de servidor (service role).
