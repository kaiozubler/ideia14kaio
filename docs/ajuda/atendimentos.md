---
titulo: Atendimentos (quadro do dia)
fontes: public/atendimentos-kanban.js, public/atendimentos-kanban.css
---

## Para que serve a tela Atendimentos?
palavras: quadro, kanban, fila, tela inicial, recepção

É a tela inicial: um quadro com o caminho do paciente no dia, da chegada até o fim da consulta. Cada coluna é uma etapa (por exemplo agendado, espera, triagem, consultório, concluído) e cada cartão é um paciente. Recepção, triagem e consultório veem o mesmo quadro em tempo real, mesmo em computadores diferentes.

## Como movo o paciente de etapa?
palavras: arrastar, mudar etapa, chamar paciente, mover cartão

Arraste o cartão para a coluna desejada, ou use os botões de ação do próprio cartão. Os horários de cada etapa são marcados automaticamente, então o tempo de espera é o mesmo em todos os computadores.

## O paciente agendado já aparece no quadro?
palavras: agendamento no quadro, cartão agendado

Sim. As consultas da Agenda aparecem sozinhas na coluna "agendado". Quando você faz a primeira ação com o cartão (por exemplo, dar entrada), ele passa a seguir pelas etapas normalmente.

## Como coloco um paciente que chegou sem agendamento?
palavras: encaixe, sem horário, chegou sem marcar, avulso

Clique em "Encaixe" na barra do topo da tela, escolha o paciente e ele entra direto na fila de espera. Ali mesmo dá para informar o valor da consulta e se já foi pago.

## Como configuro as etapas do quadro?
palavras: renomear coluna, cor da etapa, encaminhar, configurar quadro

O médico pode clicar na engrenagem no topo de uma coluna para renomear, mudar a cor ou definir para qual etapa o paciente é encaminhado depois da ação daquela etapa. Só existe uma etapa do tipo "agendado" e uma do tipo "concluído" por clínica.

## Como cobro a consulta pelo quadro?
palavras: cobrar, pagamento, recebido, valor da consulta, em aberto

Use a ação "Cobrar" do cartão. O valor fica registrado no Faturamento como um recebimento, e o cartão mostra "pago" ou "em aberto". Uma etapa também pode ser configurada para pedir a cobrança quando o paciente entra nela.

## Como desligo a triagem?
palavras: triagem, enfermagem, pular triagem, sem triagem

A triagem é opcional. Em Configurações > Minha clínica, ligue ou desligue a opção "Triagem". Desligada, as etapas de triagem somem e os pacientes que estavam nelas seguem para a próxima etapa configurada.

## O que acontece quando finalizo a consulta?
palavras: salvar e finalizar, concluído, atendido

Ao clicar em "Salvar e finalizar" no prontuário, o cartão do paciente vai para a etapa "concluído" e o agendamento fica marcado como atendido.

## O que mostra o resumo do topo?
palavras: resumo, maior espera, faltas, indicadores do dia

Mostra quem está aguardando, a maior espera, quem está no consultório, quantos foram atendidos e as faltas do período escolhido. Use o filtro de período para ver hoje, a semana, o mês ou um intervalo personalizado, e a busca para achar um paciente no quadro.
