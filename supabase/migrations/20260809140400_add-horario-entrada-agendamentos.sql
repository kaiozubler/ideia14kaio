-- Migration: registra o horário real de chegada do paciente (check-in),
-- para permitir comparar horário agendado x horário de entrada e assim
-- calcular hábitos de atraso/pontualidade na Agenda.

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS horario_entrada timestamptz;

COMMENT ON COLUMN public.agendamentos.horario_entrada IS
  'Horário real em que o paciente deu entrada (check-in) no kanban da tela Atendimentos. Nulo até a entrada ser registrada. Usado para comparar com data_hora (horário agendado) e calcular pontualidade/atraso do paciente.';
