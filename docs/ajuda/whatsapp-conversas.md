---
titulo: WhatsApp e Conversas
fontes: public/comunicacao-whatsapp.js, public/conversas-pacientes.js, src/routes/api/comunicacao/, src/routes/api/whatsapp/, src/routes/api/whatsapp-convite.ts, src/lib/comunicacao/, src/lib/whatsapp/
---

## Quais são os dois WhatsApps do sistema?
palavras: dois whatsapp, diferença whatsapp, número do assistente

Existem dois canais diferentes. O WhatsApp dos pacientes é o número da sua clínica, conectado pela API oficial da Meta, usado para conversar com pacientes, enviar lembretes e documentos (tela Conversas). O WhatsApp do assistente é o número do MediCopilot, usado só pelo médico para pedir tarefas ao Assistente IA pelo celular.

## Como conecto o WhatsApp da clínica?
palavras: conectar whatsapp, API da Meta, WhatsApp Business, credenciais

Em Configurações > WhatsApp dos pacientes, aba Conexão, informe as credenciais do WhatsApp Business da sua clínica na Meta (incluindo o App Secret) e configure o webhook com o endereço mostrado na tela. As credenciais ficam guardadas criptografadas e são só da sua clínica.

## O que são modelos de mensagem?
palavras: template, modelo aprovado, mensagem aprovada, Meta aprovar

São mensagens prontas que a Meta precisa aprovar antes do uso. Eles são necessários para iniciar uma conversa ou falar com um paciente que não mandou mensagem nas últimas 24 horas. Crie e acompanhe a aprovação em Configurações > WhatsApp dos pacientes > Modelos.

## Por que não consigo mandar mensagem livre para o paciente?
palavras: janela de 24 horas, mensagem bloqueada, não envia, 24h

Pelas regras do WhatsApp, mensagem livre só pode ser enviada até 24 horas depois da última mensagem do paciente. Fora dessa janela, use um modelo aprovado. Documentos enviados fora da janela usam o modelo escolhido nas automações.

## Como configuro lembretes e envio automático de documentos?
palavras: lembrete de consulta, confirmação automática, automações, aviso de consulta

Em Configurações > WhatsApp dos pacientes > Automações, escolha os avisos de consulta e o modelo usado para enviar documentos ao paciente.

## Como respondo os pacientes?
palavras: conversas, responder paciente, assumir conversa, atendimento whatsapp

Na tela Conversas, as conversas ficam separadas em abertas, não lidas e finalizadas. Abra uma conversa e clique em "Assumir" para responder. Dá para enviar texto, respostas rápidas e documentos. Para começar uma conversa nova, use "Nova conversa" com um modelo aprovado.

## Como falo com o assistente pelo WhatsApp?
palavras: assistente no whatsapp, copiloto pelo whatsapp, palavra-chave, verificação de segurança

Primeiro configure a verificação em Minhas IA's > Copiloto de consulta > "Copiloto pelo WhatsApp": crie uma palavra-chave de pelo menos 8 letras (só letras, até 3 repetições por letra) e escolha de quanto em quanto tempo ela será pedida (6, 12, 24 ou 36 horas). Ao iniciar uma sessão, o assistente manda grupos de letras e você indica quais contêm letras da sua palavra-chave; ela nunca é enviada por inteiro. Por segurança, a palavra-chave atual nunca é exibida; salvar uma nova substitui a anterior.

## O paciente pode agendar sozinho pelo WhatsApp?
palavras: autoatendimento, paciente agenda pelo whatsapp, convite

Sim. Peça ao Assistente IA para convidar o paciente a agendar pelo WhatsApp. O paciente conversa com uma versão restrita da IA, que só consegue consultar, marcar ou cancelar o próprio atendimento. Para isso, o número da clínica precisa estar configurado com o autoatendimento ligado.
