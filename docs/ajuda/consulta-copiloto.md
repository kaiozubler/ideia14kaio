---
titulo: Consulta e Copiloto de IA
fontes: public/medicopilot.html, public/captacao-smartphone.js, src/routes/api/chat-ia.ts, src/routes/api/deepgram-token.ts, src/routes/api/captacao-movel.ts, src/routes/captar.tsx, src/routes/api/daily-room.ts
---

## Como inicio uma consulta?
palavras: novo atendimento, abrir consulta, iniciar atendimento

Na tela Atendimentos, clique em "Iniciar atendimento" e escolha o paciente, ou abra a ficha do paciente e, na aba Atendimentos, clique em "Novo atendimento". A consulta abre com o prontuário à esquerda e o copiloto de IA à direita. Tudo é salvo como rascunho automaticamente enquanto você escreve.

## Como gravo e transcrevo a consulta?
palavras: escutar, gravar, microfone, transcrição, ditado

Clique em "Escutar". O sistema grava e transcreve a conversa em tempo real, e a transcrição aparece na barra logo abaixo (expanda para ler tudo). O navegador pede permissão para usar o microfone na primeira vez. Clique de novo para pausar.

## Qual a diferença entre transcrição básica e avançada?
palavras: qualidade da transcrição, deepgram, precisão

A transcrição avançada é mais precisa e está incluída nos planos Pro e Enterprise. A básica usa o reconhecimento de voz do próprio navegador e é a do plano Basic. Funciona melhor no Google Chrome.

## Como uso o celular como microfone da consulta?
palavras: smartphone, celular, QR code, gravar pelo celular, microfone do celular

No menu do botão "Escutar", escolha a opção de captar pelo celular. O computador mostra um QR code: aponte a câmera do celular e a gravação começa sozinha no aparelho. O QR vale por 5 minutos (gere outro se expirar) e a chamada pode durar até 4 horas. Enquanto o celular estiver conectado, o microfone do computador fica desligado, e só o computador logado pode iniciar ou retomar a captação.

## O que o copiloto faz durante a consulta?
palavras: copiloto, IA na consulta, sugestões, alertas, perguntas

O copiloto acompanha a transcrição e mostra perguntas que ainda faltam fazer, alertas, pendências de protocolo do paciente e sugestões. Você pode fixar os itens mais importantes, pedir uma sugestão de conduta ou de pergunta, e conversar com ele pelo campo de texto, inclusive anexando um exame em PDF ou imagem para análise. As sugestões são apoio: a decisão é sempre do médico.

## Qual a diferença entre copiloto ativo e reativo?
palavras: modo ativo, modo reativo, copiloto automático

No modo reativo, a IA só responde quando você pede. No modo ativo, ela analisa a conversa sozinha de tempos em tempos e traz perguntas, pontos de atenção e sugestões. O ativo está incluído no Pro, é um adicional opcional no Enterprise e não existe no Basic. A IA só faz uma nova análise automática quando há fala nova suficiente na consulta. Escolha o modo em Minhas IA's > Copiloto de consulta.

## Como configuro o copiloto?
palavras: configurações do copiloto, frequência, gravar automaticamente, insight

Em Minhas IA's > Copiloto de consulta você define se a gravação pode começar sozinha ao abrir a consulta, o tipo de copiloto (ativo ou reativo), a frequência das análises e os recursos inteligentes (perguntas iniciais, memória do paciente, pendências de protocolo e insight final). Clique em "Salvar" para aplicar nas próximas consultas.

## Como funcionam os comandos de voz na consulta?
palavras: executar, comando de voz, agendar retorno por voz, atalho de voz, palavra-chave

Dite o que quer fazer, por exemplo "agendar retorno em 30 dias", e clique em "Executar". As tarefas ficam na bandeja do topo. Você também pode criar atalhos: uma palavra-chave que, falada durante a consulta, dispara uma ação. Eles ficam em Base de conhecimento > atalhos e em Copiloto de consulta.

## Como emito documentos de dentro da consulta?
palavras: receita na consulta, atestado, pedido de exame, LME, anexar arquivo

Use o menu de documentos da consulta para emitir receita, atestado, solicitação de exames, LME, anexar arquivos ou agendar. Os documentos ficam ligados ao paciente e aparecem também em Receitas e Atestados.

## Como vejo a triagem do paciente na consulta?
palavras: triagem do dia, sinais vitais, inserir no prontuário

Se o paciente passou pela triagem no dia, ela aparece no topo da consulta. Clique em "Inserir no prontuário" para trazer os dados para a evolução. O médico também pode registrar uma triagem ali mesmo.

## O que é a nota interna no prontuário?
palavras: grifo amarelo, anotação interna, negrito

Na barra de formatação do prontuário há negrito, itálico e nota interna. A nota interna aparece grifada em amarelo para destacar algo que é só para você.

## Como faço uma teleconsulta por vídeo?
palavras: telemedicina, vídeo, videochamada, consulta online, chamada de vídeo, sala de vídeo

Ao agendar, escolha a modalidade "Vídeo por link". Na hora da consulta, abra o atendimento do paciente e clique no botão azul "Vídeo", na parte de baixo da tela do atendimento: ele abre a sala de vídeo daquele paciente. A setinha ao lado do botão "Vídeo" tem três opções: "Acessar sala", "Criar nova sala" (gera uma sala nova, caso precise) e "Copiar link da chamada". Os minutos de vídeo fazem parte da franquia do plano.

## Onde copio o link da chamada de vídeo para mandar ao paciente?
palavras: link da teleconsulta, link do vídeo, link da sala, copiar link, enviar link, compartilhar link, link de vídeo

Com o atendimento do paciente aberto, clique na setinha ao lado do botão azul "Vídeo" (parte de baixo da tela do atendimento) e escolha "Copiar link da chamada". O link vai para a área de transferência, sem você entrar na sala, e é só colar na mensagem para o paciente. Se você já estiver dentro da chamada, abra "Participantes" na barra da chamada e clique em "Copiar link da chamada". Quando a consulta foi agendada como "Vídeo por link", as mensagens automáticas de WhatsApp podem levar o link sozinhas, se o modelo da mensagem usar a variável do link de vídeo.

## Como encerro a consulta?
palavras: finalizar, salvar consulta, terminar atendimento, rascunho

Clique em "Salvar e finalizar". A consulta fica registrada no prontuário e o paciente vai para "concluído" no quadro. Enquanto não é finalizada, a consulta é um rascunho e pode ser descartada. Depois de finalizada, ela não volta a ser rascunho e não pode ser excluída, só editada, e cada edição guarda a versão anterior.
