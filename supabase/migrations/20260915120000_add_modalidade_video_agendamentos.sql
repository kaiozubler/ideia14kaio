-- Migration: suporte a consultas por vídeo no agendamento.
--
-- Permite marcar um agendamento como presencial ou por vídeo, guarda a
-- sala/link do Daily criada para AQUELE agendamento (para o médico e o
-- paciente sempre usarem o mesmo link, em vez de o médico gerar uma sala
-- nova na hora) e registra quando o link foi enviado ao paciente, para o
-- futuro job de lembrete (15-30min antes) não reenviar duplicado.

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS modalidade text NOT NULL DEFAULT 'presencial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agendamentos_modalidade_check'
  ) THEN
    ALTER TABLE public.agendamentos
      ADD CONSTRAINT agendamentos_modalidade_check
      CHECK (modalidade IN ('presencial','video'));
  END IF;
END $$;

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS video_room_name text;

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS video_room_url text;

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS video_link_enviado_em timestamptz;

COMMENT ON COLUMN public.agendamentos.modalidade IS
  'Tipo do atendimento agendado: presencial ou video. Define se a consulta ocorre por chamada de vídeo.';
COMMENT ON COLUMN public.agendamentos.video_room_name IS
  'Nome da sala Daily criada para este agendamento (mesmo nome usado no /api/daily-room). Preenchido quando modalidade = video, na criação do agendamento ou no primeiro envio do link. Permite que médico e paciente sempre entrem na mesma sala.';
COMMENT ON COLUMN public.agendamentos.video_room_url IS
  'URL pública da sala Daily (o mesmo link enviado ao paciente). Nula até a sala ser criada.';
COMMENT ON COLUMN public.agendamentos.video_link_enviado_em IS
  'Horário em que o link da videochamada foi efetivamente enviado ao paciente (WhatsApp/e-mail). Nulo até o envio ocorrer; usado pelo job de lembrete para não enviar duas vezes.';

-- Índice parcial para o job de lembrete: busca rápida por agendamentos de
-- vídeo cujo link ainda não foi enviado, dentro da janela de tempo alvo.
CREATE INDEX IF NOT EXISTS idx_agendamentos_video_pendente
  ON public.agendamentos (data_hora)
  WHERE modalidade = 'video' AND video_link_enviado_em IS NULL;
