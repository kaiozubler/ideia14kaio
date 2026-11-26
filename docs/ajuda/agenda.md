---
titulo: Agenda e agendamento online
fontes: public/agendamento-online.js, public/agendamento-online.css, src/routes/agendar.$token.tsx, src/routes/api/agendamento/, src/routes/api/public/agendamento/, src/lib/agendamento/
---

## Como marco uma consulta?
palavras: agendar, marcar consulta, novo agendamento, horário

Na Agenda, clique em "Novo agendamento", escolha paciente, profissional, dia e horário, e se é presencial ou "Vídeo por link". Também dá para pedir ao Assistente IA, por exemplo "agende a Maria amanhã às 14h". Se o horário estiver ocupado, o sistema avisa e sugere outros.

## Como mudo a visualização da agenda?
palavras: diário, semanal, mensal, ver agenda de um médico

Use os botões de visualização para alternar entre diário, semanal e mensal. No seletor de profissional você vê a agenda de um médico ou de todos. Em "Filtros" dá para filtrar por especialidade e status (confirmado, faltoso, compareceu e outros).

## Como confirmo, remarco ou dou entrada em uma consulta?
palavras: confirmar consulta, remarcar, cancelar consulta, dar entrada, faltou

Clique na consulta no calendário: ali você confirma, remarca, cancela ou dá entrada no quadro de Atendimentos. A confirmação pode ser enviada ao paciente pelo WhatsApp; o paciente nunca recebe a mesma confirmação duas vezes.

## Como o paciente marca consulta sozinho pela internet?
palavras: agendamento online, link de agendamento, paciente agendar, autoagendamento

Em Configurações > Agendamento online, ligue o recurso, defina os horários da clínica e de cada médico e copie o link. Compartilhe o link com os pacientes (site, Instagram, WhatsApp). O paciente vê só os horários livres, escolhe e informa nome, CPF, telefone e, se quiser, uma observação. A consulta aparece na Agenda.

## Quais horários aparecem no link de agendamento?
palavras: horários disponíveis, grade, horário do médico

Só aparecem horários dentro do funcionamento da clínica, dentro dos horários do médico escolhido e sem outra consulta marcada. Uma consulta sem médico definido bloqueia aquele horário para todos os médicos. Os horários são sempre no horário de Brasília.

## O link de agendamento tem algum limite?
palavras: limite de agendamentos, spam, muitas marcações

Sim, para evitar abuso: o mesmo CPF ou telefone pode fazer no máximo 3 agendamentos pelo link a cada 8 horas e ter no máximo 3 consultas futuras marcadas por ele. O link para de funcionar se o recurso for desligado ou se a assinatura da clínica não estiver ativa.

## Como troco o link de agendamento?
palavras: novo link, trocar link, revogar link, link vazou

Em Configurações > Agendamento online, use a opção de gerar novo link. Por segurança, é preciso digitar a frase "TROCAR LINK" e a senha da conta (ou o e-mail, para quem entra com Google). O link antigo para de funcionar, então atualize todos os lugares onde ele foi publicado.

## Como cadastro outro médico na agenda?
palavras: adicionar médico, mais de um médico, profissionais da agenda

Os médicos da agenda são configurados em Configurações > Agendamento online, cada um com seus horários. A quantidade de médicos ativos depende do plano. Secretária e enfermagem não entram como médicos; elas são convidadas em Minha equipe.
