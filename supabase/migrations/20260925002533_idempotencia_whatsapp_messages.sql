-- A API do WhatsApp reentrega (retry) uma mensagem de webhook se não
-- receber confirmação rápida o suficiente — e pode tentar de novo por
-- horas depois, processando uma mensagem antiga como se fosse nova.
-- Esse índice único torna o log de mensagens recebidas a chave de
-- idempotência: se o mesmo wa_message_id (ID da mensagem na Meta) já foi
-- registrado como recebido, é uma reentrega, não uma mensagem nova.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wa_message_id_inbound_uidx
  ON public.whatsapp_messages (wa_message_id)
  WHERE direction = 'inbound' AND wa_message_id IS NOT NULL;
