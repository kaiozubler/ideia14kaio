-- Canal Médico ↔ assistente_ai pelo WhatsApp (número único do app, diferente
-- do número por clínica usado em medico_whatsapp_config / whatsapp_conversas,
-- que é exclusivo do canal Paciente ↔ Clínica).
--
-- Esta tabela só guarda o mapeamento telefone-do-médico -> conversa em
-- ia_assist_conversas, para o webhook saber qual conversa continuar a cada
-- nova mensagem (evitando criar uma conversa nova, com geração de título,
-- a cada mensagem recebida). O conteúdo das mensagens em si já fica em
-- ia_assist_conversas.mensagens — não é duplicado aqui.
CREATE TABLE IF NOT EXISTS public.medico_assistente_sessoes_whatsapp (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null references auth.users(id) on delete cascade,
  telefone text not null,
  conversa_id uuid references public.ia_assist_conversas(id) on delete set null,
  ultima_interacao timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id_medico, telefone)
);

CREATE INDEX IF NOT EXISTS medico_assistente_sessoes_whatsapp_telefone_idx
  ON public.medico_assistente_sessoes_whatsapp (telefone);

GRANT ALL ON public.medico_assistente_sessoes_whatsapp TO service_role;
ALTER TABLE public.medico_assistente_sessoes_whatsapp ENABLE ROW LEVEL SECURITY;

-- Tabela de uso exclusivo do webhook (service_role, que ignora RLS). Nenhum
-- acesso direto do app/cliente é esperado — mesmo padrão usado em
-- whatsapp_messages.
CREATE POLICY "medico_assistente_sessoes_whatsapp server only"
  ON public.medico_assistente_sessoes_whatsapp
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
