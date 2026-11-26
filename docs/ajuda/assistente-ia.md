---
titulo: Assistente IA, extensão e base de conhecimento
fontes: src/routes/api/assistente-ia.ts, public/assistente-voz.js, extension/, public/base-conhecimento.js, src/routes/api/base-conhecimento/, src/routes/api/pesquisa/, src/lib/extensao/
---

## O que o Assistente IA consegue fazer?
palavras: assistente, o que posso pedir, comandos, IA do app

O Assistente IA faz tarefas por mensagem: agendar pacientes, consultar a agenda do dia, gerar receitas, atestados e solicitações de exames, enviar mensagens e documentos ao paciente pelo WhatsApp, convidar o paciente a agendar sozinho, criar cadastros, gerar anamnese a partir dos seus modelos, analisar um exame anexado e tirar dúvidas de uso do sistema. Abra pelo botão do assistente no canto da tela e escreva, por exemplo, "agende a Maria amanhã às 14h".

## O assistente faz alguma coisa sem eu confirmar?
palavras: confirmação, segurança do assistente, enviar sem pedir

Não para ações importantes. Ele sempre pede sua confirmação antes de enviar mensagem ou documento ao paciente, agendar ou remarcar, salvar exame ou criar cadastro. Consultas, como ver a agenda, não precisam de confirmação.

## Posso falar com o assistente por voz?
palavras: voz, falar, conversar ao vivo, microfone do assistente

Sim. No assistente, use "Conversar ao vivo": você fala, ele responde em texto e em voz. Enquanto ele fala, o microfone fica desligado; toque no botão para interromper. Não dá para usar enquanto a consulta estiver sendo gravada, para não misturar os áudios. Dados como CPF e telefone não são lidos em voz alta.

## Como instalo a extensão do navegador?
palavras: extensão, chrome, plugin, painel lateral, instalar extensão

Em Configurações > Minha equipe, no seu perfil, clique em "Instalar extensão". O arquivo medicopilot-extension.zip é baixado. Descompacte em uma pasta, abra chrome://extensions, ative o "Modo do desenvolvedor", clique em "Carregar sem compactação" e escolha a pasta. Clique no ícone da extensão para abrir o painel lateral e entre com o mesmo e-mail e senha do MediCopilot (o login é pedido a cada 30 dias). Funciona no Chrome, Edge, Brave, Arc e Opera.

## O que a extensão faz?
palavras: extensão preencher, preencher tela, outro sistema, prontuário externo

Ela leva o Assistente IA para qualquer site, num painel lateral: ele lê a tela aberta como contexto e conversa com você. O botão "Preencher tela" sugere valores para os campos da página a partir da conversa e dos dados do médico e do paciente. Você revisa cada campo antes de aplicar (dá para desfazer) e a extensão nunca envia o formulário sozinha. O paciente só é identificado por um CPF válido mostrado na página. O botão de gravar inicia um novo atendimento.

## Atualizei o app e a extensão não tem a função nova. E agora?
palavras: atualizar extensão, versão da extensão, extensão desatualizada

Baixe de novo em Minha equipe > "Instalar extensão", substitua a pasta antiga pela nova e clique em recarregar na extensão em chrome://extensions.

## O que é a Base de conhecimento?
palavras: base de conhecimento, meus documentos, materiais, PDF para a IA

São materiais seus (PDF, TXT ou texto colado) que as IAs consultam ao responder. Em Base de conhecimento, clique em "Nova base", envie o conteúdo e escolha quais IAs podem usá-la (copiloto da consulta e/ou Assistente IA).

## Como pesquiso na literatura médica?
palavras: pesquisa, PubMed, Cochrane, SciELO, artigos, evidência

Na Base de conhecimento, use o campo de pesquisa. Ele busca ao mesmo tempo na IA, nas suas bases e em fontes como PubMed, Cochrane e SciELO. Clique no campo para escolher as fontes. Os resultados em inglês podem ser traduzidos.

## Como crio um modelo de anamnese?
palavras: anamnese, prompt, modelo, gerador de anamnese

Em Minhas IA's > Gerador de Anamnese, clique em "Novo prompt" e descreva a estrutura e o tom que prefere. Depois, peça ao Assistente IA para gerar a anamnese: ele mostra seus modelos, você escolhe, e ele monta o texto só com o que foi contado na conversa. Se quiser, ele salva no cadastro do paciente.

## Qual IA o copiloto usa?
palavras: modelo de IA, Gemini, Claude, trocar IA

O copiloto da consulta pode usar Gemini ou Claude. Escolha em Minhas IA's > Copiloto de consulta, no seletor de IA, e salve. No mesmo lugar dá para escolher a transcrição básica, mesmo em planos com a avançada. Todas as IAs do app são de apoio e não substituem a decisão clínica do médico.
