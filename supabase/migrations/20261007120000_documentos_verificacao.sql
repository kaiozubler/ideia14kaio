-- Verificacao publica de documentos emitidos (QR code da receita). Documentacao em src/lib/documentos/verificacao.server.ts e AGENTS.md

CREATE TABLE IF NOT EXISTS public.documentos_verificacao (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null references auth.users(id) on delete cascade,
  codigo text not null check (length(codigo) = 10 and codigo !~ '[^2-9A-HJ-NP-Z]'),
  token_hash text not null,
  senha_hash text not null,
  status text not null default 'reservado' check (status in ('reservado', 'emitido', 'revogado')),
  tipo text,
  titulo text,
  paciente_nome text,
  medico_nome text,
  medico_crm text,
  medico_especialidade text,
  clinica jsonb not null default '{}'::jsonb,
  arquivo_path text,
  arquivo_sha256 text,
  arquivo_bytes integer,
  assinatura jsonb,
  emitido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS documentos_verificacao_codigo_uidx ON public.documentos_verificacao (codigo);

CREATE INDEX IF NOT EXISTS documentos_verificacao_medico_idx ON public.documentos_verificacao (id_medico, created_at desc);

GRANT ALL ON public.documentos_verificacao TO service_role;

ALTER TABLE public.documentos_verificacao ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_documentos_verificacao_updated ON public.documentos_verificacao;

CREATE TRIGGER trg_documentos_verificacao_updated BEFORE UPDATE ON public.documentos_verificacao FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.documentos_verificacao_tentativas (
  id uuid primary key default gen_random_uuid(),
  verificacao_id uuid not null references public.documentos_verificacao(id) on delete cascade,
  sucesso boolean not null default false,
  ip text,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS documentos_verificacao_tentativas_idx ON public.documentos_verificacao_tentativas (verificacao_id, created_at desc);

GRANT ALL ON public.documentos_verificacao_tentativas TO service_role;

ALTER TABLE public.documentos_verificacao_tentativas ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public) VALUES ('documentos-verificacao', 'documentos-verificacao', false) ON CONFLICT (id) DO NOTHING;
