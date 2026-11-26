---
titulo: Pacientes e prontuário
fontes: public/prontuario-exportar.js, public/mapa-familiar.css, src/routes/api/pacientes/, src/routes/api/mapa-familiar-ia.ts
---

## Como cadastro um paciente?
palavras: novo paciente, cadastrar, criar paciente

Na tela Pacientes, clique em "Novo paciente" e preencha os dados. Ao digitar o CEP, o endereço é preenchido sozinho. O Assistente IA também pode criar o cadastro por mensagem. O CPF é importante: sem um CPF válido não é possível exportar o prontuário nem enviar documentos verificáveis.

## Como encontro um paciente?
palavras: buscar paciente, pesquisar, filtro, CPF, cartão SUS

Na tela Pacientes, digite na busca o nome, CPF, telefone ou cartão SUS. Em "Filtros avançados" você combina convênio, cidade, sexo, grupo e data do último atendimento. Dá para ordenar por nome ou pelo atendimento mais recente.

## Posso agir em vários pacientes de uma vez?
palavras: ações em massa, selecionar vários, exportar lista

Sim. Marque as caixas dos pacientes na lista para enviar mensagem, agendar, dar entrada no quadro ou exportar vários de uma vez.

## O que tem na ficha do paciente?
palavras: abas, ficha, prontuário completo, timeline

A ficha tem o cabeçalho com idade, convênio, profissional responsável e última consulta, e as abas Cadastro, Atendimentos, Exames, Protocolos, Financeiro, Agenda, Timeline e Prontuário completo. Na aba Cadastro, edite os dados e salve pelo botão flutuante no rodapé.

## Por que não consigo excluir um paciente ou uma consulta?
palavras: apagar, excluir, deletar, remover paciente, apagar consulta

Por lei, o prontuário deve ser guardado por 20 anos. Por isso consultas finalizadas, exames, triagens, documentos e medicamentos em uso nunca são excluídos. Um paciente só pode ser excluído se não tiver nenhum desses registros. Se o cadastro foi criado em duplicidade, use "Migrar paciente".

## O que faço com um paciente cadastrado em duplicidade?
palavras: duplicado, mesclar, unificar, juntar cadastros, migrar paciente

Abra a ficha do cadastro que vai sair, clique no menu de ações e escolha "Migrar paciente". Busque o paciente de destino pelo nome ou CPF. Consultas, exames, documentos, agendamentos, protocolos, financeiro e timeline passam para o paciente escolhido e o cadastro de origem é removido.

## Como vejo o que foi alterado no prontuário?
palavras: histórico, versões, edição, quem alterou, auditoria

Toda edição de consulta, exame, triagem, documento ou cadastro guarda a versão anterior, com o nome de quem alterou e o motivo. O histórico aparece na tela e também na impressão do prontuário.

## Como exporto ou imprimo o prontuário?
palavras: exportar prontuário, imprimir, PDF do prontuário, enviar prontuário

Na ficha do paciente, use as ações do prontuário para imprimir ou baixar o PDF. A opção "Assinar e enviar" assina digitalmente e envia ao paciente pelo WhatsApp; se a assinatura falhar, o arquivo é só baixado e não é enviado. O paciente precisa ter CPF válido. Campos obrigatórios em branco aparecem como "não informado" no documento.

## O que é a memória do paciente?
palavras: memória, resumo do paciente, IA lembra

É um resumo que as IAs vão montando com o que aparece nas consultas, para o copiloto lembrar do histórico do paciente nas próximas vezes. Fica nas ações do prontuário, na ficha do paciente.

## Para que serve o Mapa Familiar?
palavras: família, árvore genealógica, parentesco, doenças hereditárias

O Mapa Familiar monta as famílias a partir dos parentescos cadastrados nos pacientes, para ver doenças que se repetem. Busque por paciente, sobrenome ou CID, e marque "Consanguíneos" para considerar só parentes de sangue. Abra uma família para ver a árvore e os CIDs de cada membro.

## A secretária consegue ver o prontuário?
palavras: secretária vê prontuário, privacidade, acesso da equipe

Não. Secretária e enfermagem veem e editam só o cadastro do paciente (dados pessoais), além de agenda, quadro e, conforme o papel, triagem e cobranças. Consultas, exames, documentos e dados clínicos são exclusivos do médico.
