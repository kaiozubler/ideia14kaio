-- Rastreia explicitamente qual paciente está "ativo" na conversa do médico
-- pelo WhatsApp, pra reinjetar esse contexto a cada mensagem em vez de
-- depender só do modelo reconstruir isso lendo o histórico em texto livre
-- (o que se mostrou pouco confiável em conversas mais longas/com desvios).
ALTER TABLE public.medico_assistente_sessoes_whatsapp
  ADD COLUMN IF NOT EXISTS paciente_ativo jsonb;
