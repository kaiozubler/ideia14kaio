-- Marca, por resposta, se o paciente confirmou o código enviado por email
-- antes de enviar (só é gravado true quando o formulário exige autenticação
-- por email e o código foi validado em responder.ts). Isso permite exibir um
-- selo "Assinado por... (email verificado)" mesmo que a configuração do
-- formulário mude depois — o registro fica preso à resposta em si.
ALTER TABLE public.questionario_respostas
  ADD COLUMN IF NOT EXISTS email_verificado boolean NOT NULL DEFAULT false;
