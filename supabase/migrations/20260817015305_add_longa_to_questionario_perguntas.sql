-- Adiciona a coluna "longa" (resposta longa/parágrafo x curta) que faltava
-- em questionario_perguntas — sem ela, o toggle "Resposta longa (parágrafo)"
-- do construtor não era persistido.
alter table public.questionario_perguntas
  add column if not exists longa boolean not null default false;
