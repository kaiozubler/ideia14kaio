-- Canal clinica paciente pelo WhatsApp. Documentacao em src/lib/comunicacao e AGENTS.md

CREATE TABLE IF NOT EXISTS public.comunicacao_whatsapp_conexoes (
  id_medico uuid primary key references auth.users(id) on delete cascade,
  webhook_chave uuid not null default gen_random_uuid(),
  meta_app_id text,
  meta_business_id text,
  waba_id text,
  phone_number_id text,
  access_token_cifrado text,
  app_secret_cifrado text,
  verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  graph_api_version text not null default 'v23.0' check (length(graph_api_version) = 5 and graph_api_version ~ '^v[0-9]{2}[.][0-9]'),
  numero_exibicao text,
  nome_verificado text,
  nome_waba text,
  quality_rating text,
  messaging_limit_tier text,
  status text not null default 'rascunho' check (status in ('rascunho', 'conectado', 'erro', 'desconectado')),
  ultimo_erro text,
  testado_em timestamptz,
  webhook_assinado_em timestamptz,
  webhook_verificado_em timestamptz,
  ultimo_evento_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS comunicacao_whatsapp_conexoes_webhook_chave_uidx ON public.comunicacao_whatsapp_conexoes (webhook_chave);

CREATE UNIQUE INDEX IF NOT EXISTS comunicacao_whatsapp_conexoes_phone_number_id_uidx ON public.comunicacao_whatsapp_conexoes (phone_number_id);

GRANT ALL ON public.comunicacao_whatsapp_conexoes TO service_role;

ALTER TABLE public.comunicacao_whatsapp_conexoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comunicacao_whatsapp_conexoes server only" ON public.comunicacao_whatsapp_conexoes;

CREATE POLICY "comunicacao_whatsapp_conexoes server only" ON public.comunicacao_whatsapp_conexoes FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_comunicacao_whatsapp_conexoes_updated ON public.comunicacao_whatsapp_conexoes;

CREATE TRIGGER trg_comunicacao_whatsapp_conexoes_updated BEFORE UPDATE ON public.comunicacao_whatsapp_conexoes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.comunicacao_whatsapp_modelos (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null references auth.users(id) on delete cascade,
  meta_template_id text,
  nome text not null check (length(nome) between 1 and 512 and nome !~ '[^a-z0-9_]'),
  idioma text not null default 'pt_BR',
  categoria text not null default 'UTILITY' check (categoria in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  finalidade text not null default 'geral' check (finalidade in ('geral', 'chamada', 'lembrete_consulta', 'confirmacao_agendamento', 'envio_documento', 'retorno', 'cobranca')),
  parameter_format text not null default 'POSITIONAL' check (parameter_format in ('POSITIONAL', 'NAMED')),
  cabecalho jsonb,
  corpo text not null,
  corpo_exemplos jsonb not null default '[]'::jsonb,
  rodape text,
  botoes jsonb not null default '[]'::jsonb,
  variaveis jsonb not null default '{}'::jsonb,
  status text not null default 'RASCUNHO' check (status in ('RASCUNHO', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION', 'DELETED', 'LIMIT_EXCEEDED', 'ARCHIVED')),
  motivo_rejeicao text,
  sincronizado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS comunicacao_whatsapp_modelos_nome_idioma_uidx ON public.comunicacao_whatsapp_modelos (id_medico, nome, idioma);

CREATE INDEX IF NOT EXISTS comunicacao_whatsapp_modelos_medico_idx ON public.comunicacao_whatsapp_modelos (id_medico, status);

GRANT SELECT ON public.comunicacao_whatsapp_modelos TO authenticated;

GRANT ALL ON public.comunicacao_whatsapp_modelos TO service_role;

ALTER TABLE public.comunicacao_whatsapp_modelos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico le seus modelos de WhatsApp" ON public.comunicacao_whatsapp_modelos;

CREATE POLICY "Medico le seus modelos de WhatsApp" ON public.comunicacao_whatsapp_modelos FOR SELECT TO authenticated USING (auth.uid() = id_medico);

DROP TRIGGER IF EXISTS trg_comunicacao_whatsapp_modelos_updated ON public.comunicacao_whatsapp_modelos;

CREATE TRIGGER trg_comunicacao_whatsapp_modelos_updated BEFORE UPDATE ON public.comunicacao_whatsapp_modelos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.comunicacao_whatsapp_conversas (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null references auth.users(id) on delete cascade,
  paciente_id uuid references public.pacientes(paciente_id) on delete set null,
  telefone text not null check (length(telefone) between 8 and 15 and telefone !~ '[^0-9]'),
  nome_contato text,
  ultima_mensagem text,
  ultima_mensagem_em timestamptz,
  ultima_entrada_em timestamptz,
  nao_lidas integer not null default 0,
  responsavel text,
  status text not null default 'aberta' check (status in ('aberta', 'finalizada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS comunicacao_whatsapp_conversas_telefone_uidx ON public.comunicacao_whatsapp_conversas (id_medico, telefone);

CREATE INDEX IF NOT EXISTS comunicacao_whatsapp_conversas_lista_idx ON public.comunicacao_whatsapp_conversas (id_medico, ultima_mensagem_em desc);

GRANT SELECT, UPDATE ON public.comunicacao_whatsapp_conversas TO authenticated;

GRANT ALL ON public.comunicacao_whatsapp_conversas TO service_role;

ALTER TABLE public.comunicacao_whatsapp_conversas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico le suas conversas de WhatsApp" ON public.comunicacao_whatsapp_conversas;

CREATE POLICY "Medico le suas conversas de WhatsApp" ON public.comunicacao_whatsapp_conversas FOR SELECT TO authenticated USING (auth.uid() = id_medico);

DROP POLICY IF EXISTS "Medico atualiza suas conversas de WhatsApp" ON public.comunicacao_whatsapp_conversas;

CREATE POLICY "Medico atualiza suas conversas de WhatsApp" ON public.comunicacao_whatsapp_conversas FOR UPDATE TO authenticated USING (auth.uid() = id_medico) WITH CHECK (auth.uid() = id_medico);

DROP TRIGGER IF EXISTS trg_comunicacao_whatsapp_conversas_updated ON public.comunicacao_whatsapp_conversas;

CREATE TRIGGER trg_comunicacao_whatsapp_conversas_updated BEFORE UPDATE ON public.comunicacao_whatsapp_conversas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.comunicacao_whatsapp_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.comunicacao_whatsapp_conversas(id) on delete cascade,
  id_medico uuid not null references auth.users(id) on delete cascade,
  direcao text not null check (direcao in ('entrada', 'saida')),
  tipo text not null default 'text',
  conteudo text,
  midia jsonb,
  modelo_id uuid references public.comunicacao_whatsapp_modelos(id) on delete set null,
  modelo_parametros jsonb,
  wa_message_id text,
  status text not null default 'enviando' check (status in ('enviando', 'enviada', 'entregue', 'lida', 'falhou', 'recebida')),
  erro text,
  enviado_por uuid references auth.users(id) on delete set null,
  documento_id uuid references public.documentos_paciente(id) on delete set null,
  agendamento_id uuid references public.agendamentos(id) on delete set null,
  criada_em timestamptz not null default now(),
  status_em timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS comunicacao_whatsapp_mensagens_wa_id_uidx ON public.comunicacao_whatsapp_mensagens (wa_message_id);

CREATE INDEX IF NOT EXISTS comunicacao_whatsapp_mensagens_conversa_idx ON public.comunicacao_whatsapp_mensagens (conversa_id, criada_em);

GRANT SELECT ON public.comunicacao_whatsapp_mensagens TO authenticated;

GRANT ALL ON public.comunicacao_whatsapp_mensagens TO service_role;

ALTER TABLE public.comunicacao_whatsapp_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico le suas mensagens de WhatsApp" ON public.comunicacao_whatsapp_mensagens;

CREATE POLICY "Medico le suas mensagens de WhatsApp" ON public.comunicacao_whatsapp_mensagens FOR SELECT TO authenticated USING (auth.uid() = id_medico);

CREATE TABLE IF NOT EXISTS public.comunicacao_whatsapp_automacoes (
  id_medico uuid primary key references auth.users(id) on delete cascade,
  lembrete_ativo boolean not null default false,
  lembrete_horas_antes integer not null default 24 check (lembrete_horas_antes between 1 and 168),
  lembrete_modelo_id uuid references public.comunicacao_whatsapp_modelos(id) on delete set null,
  confirmacao_ativo boolean not null default false,
  confirmacao_modelo_id uuid references public.comunicacao_whatsapp_modelos(id) on delete set null,
  documento_modelo_id uuid references public.comunicacao_whatsapp_modelos(id) on delete set null,
  horario_inicio time not null default '08:00',
  horario_fim time not null default '20:00',
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE ON public.comunicacao_whatsapp_automacoes TO authenticated;

GRANT ALL ON public.comunicacao_whatsapp_automacoes TO service_role;

ALTER TABLE public.comunicacao_whatsapp_automacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico gerencia suas automacoes de WhatsApp" ON public.comunicacao_whatsapp_automacoes;

CREATE POLICY "Medico gerencia suas automacoes de WhatsApp" ON public.comunicacao_whatsapp_automacoes FOR ALL TO authenticated USING (auth.uid() = id_medico) WITH CHECK (auth.uid() = id_medico);

DROP TRIGGER IF EXISTS trg_comunicacao_whatsapp_automacoes_updated ON public.comunicacao_whatsapp_automacoes;

CREATE TRIGGER trg_comunicacao_whatsapp_automacoes_updated BEFORE UPDATE ON public.comunicacao_whatsapp_automacoes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.comunicacao_whatsapp_envios_automaticos (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null references auth.users(id) on delete cascade,
  agendamento_id uuid not null references public.agendamentos(id) on delete cascade,
  tipo text not null check (tipo in ('lembrete_consulta', 'confirmacao_agendamento')),
  mensagem_id uuid references public.comunicacao_whatsapp_mensagens(id) on delete set null,
  sucesso boolean not null default true,
  erro text,
  criado_em timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS comunicacao_whatsapp_envios_automaticos_uidx ON public.comunicacao_whatsapp_envios_automaticos (agendamento_id, tipo);

GRANT ALL ON public.comunicacao_whatsapp_envios_automaticos TO service_role;

ALTER TABLE public.comunicacao_whatsapp_envios_automaticos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comunicacao_whatsapp_envios_automaticos server only" ON public.comunicacao_whatsapp_envios_automaticos;

CREATE POLICY "comunicacao_whatsapp_envios_automaticos server only" ON public.comunicacao_whatsapp_envios_automaticos FOR ALL TO authenticated USING (false) WITH CHECK (false);
