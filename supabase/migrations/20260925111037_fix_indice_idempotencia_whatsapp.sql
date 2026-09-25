-- Correção urgente: o índice único parcial criado na migration anterior
-- (WHERE direction = 'inbound') não é compatível com o "ON CONFLICT
-- (wa_message_id)" simples usado no upsert do webhook — o Postgres só
-- casa um ON CONFLICT sem predicado com um índice único COMPLETO na(s)
-- mesma(s) coluna(s). Isso quebrava a inserção em toda mensagem recebida
-- (erro "no unique or exclusion constraint matching the ON CONFLICT
-- specification"), travando o webhook por completo.
--
-- Troca para um índice único simples (não parcial). Seguro porque
-- mensagens de saída (direction = 'outbound') nunca preenchem
-- wa_message_id (fica NULL), e o Postgres não considera múltiplos NULLs
-- como conflito num índice único.
DROP INDEX IF EXISTS public.whatsapp_messages_wa_message_id_inbound_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wa_message_id_uidx
  ON public.whatsapp_messages (wa_message_id);
