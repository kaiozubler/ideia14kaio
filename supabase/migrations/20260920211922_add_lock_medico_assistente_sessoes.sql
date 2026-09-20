-- Trava leve para serializar mensagens da mesma conversa (médico x
-- assistente_ai pelo WhatsApp) que cheguem quase ao mesmo tempo. Sem isso,
-- duas mensagens em sequência rápida (ex.: "Outro assunto" seguido
-- imediatamente de outro pedido) podem ser processadas em paralelo, e a
-- segunda pode ler o estado da sessão antes da primeira terminar de
-- gravar — fazendo, por exemplo, um reset de assunto "não pegar".
ALTER TABLE public.medico_assistente_sessoes_whatsapp
  ADD COLUMN IF NOT EXISTS bloqueio_processamento_em timestamptz;
