-- Formulários nominais agora escolhem quais campos do cadastro do paciente
-- fazem parte do questionário (nome/cpf/telefone/email são fixos e
-- obrigatórios; os demais são opcionais, selecionados pelo médico no
-- construtor).
alter table public.questionarios
  add column if not exists campos_cadastro jsonb not null default '["name","cpf","telefone","email"]'::jsonb;
