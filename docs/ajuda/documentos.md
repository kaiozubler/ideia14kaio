---
titulo: Receitas, atestados e documentos
fontes: public/receituario-controlado.js, public/receita-modelo.html, public/receita-controle-especial-modelo.html, public/notificacao-receita-modelo.html, public/solicitacao-exames-modelo.html, public/lme-modelo.html, public/lme-documentos-uf.js, public/lme-estabelecimentos.js, public/integra-bry-connect.js, src/routes/api/documentos/, src/routes/api/bry/, src/routes/api/signature/, src/routes/api/lme-ia.ts, src/routes/v.$codigo.tsx
---

## Como gero uma receita?
palavras: receita, prescrição, receituário, prescrever

Dentro da consulta, use o menu de documentos e escolha receita. Fora da consulta, vá em Receitas e Atestados e clique em "Gerar documento". Também dá para pedir ao Assistente IA, por exemplo "gere uma receita de amoxicilina 500 mg para a Maria". Toda receita precisa de nome, CPF e idade do paciente.

## Como funciona a receita de medicamento controlado?
palavras: controle especial, controlado, portaria 344, antibiótico, retenção, segunda via

O sistema separa os documentos conforme a regra de cada medicamento: receita comum, receita de Controle Especial, receita retida em 2 vias (por exemplo antimicrobianos) e uma notificação para cada medicamento que exige. Cada tipo sai em um PDF separado, para a farmácia reter só o que a norma pede.

## Posso emitir a Notificação de Receita (amarela ou azul)?
palavras: notificação de receita, receita amarela, receita azul, talonário, NR

O sistema gera apenas um espelho de transcrição, com marca d'água e o número do seu talonário, para facilitar o preenchimento. Esse espelho não vale para a farmácia dispensar: use o talonário oficial.

## Como gero um atestado ou declaração?
palavras: atestado, declaração de comparecimento, afastamento, CID no atestado

Na consulta, pelo menu de documentos, ou em Receitas e Atestados > "Gerar documento". O Assistente IA também gera: ele pergunta se você quer incluir o CID ou seguir sem ele.

## Como faço uma solicitação de exames?
palavras: pedido de exame, guia de exame, TUSS, solicitar exames

Na consulta, pelo menu de documentos, ou em Receitas e Atestados > "Gerar documento". Os exames são buscados pelo nome com o código TUSS. O padrão é caráter eletivo; marque urgente quando for o caso. Exames odontológicos não fazem parte do sistema.

## Como assino documentos digitalmente?
palavras: assinatura digital, certificado, ICP-Brasil, A1, A3, BRy, nuvem, assinar

Conecte seu certificado ICP-Brasil em Configurações > Minha equipe, no seu perfil, em "Conectar certificado". Você pode usar um arquivo A1 (.pfx/.p12), o Certificado em Nuvem da BRy ou um certificado A1/A3 hospedado em outra certificadora (você autentica direto no site dela; nenhum dado do certificado é digitado no MediCopilot). Depois disso, receitas, atestados e pedidos de exame saem assinados.

## Por que meu documento saiu com linha para assinar à mão?
palavras: assinatura falhou, sem assinatura digital, linha de assinatura, certificado expirado

Quando a assinatura digital não dá certo (certificado vencido, sessão da certificadora expirada ou certificado não conectado), o PDF é gerado com uma linha para assinatura manuscrita, sem o selo de "assinado digitalmente". Reconecte o certificado no seu perfil e gere o documento de novo se precisar da versão assinada.

## Para que serve o QR code nos documentos?
palavras: QR code, verificar documento, autenticidade, validar receita, farmácia

Todo documento sai com um QR code e um link curto de verificação. Quem recebe pode abrir o link e confirmar quem assinou e se o documento não foi alterado. Pelo link curto, a página pede os 4 primeiros dígitos do CPF do paciente.

## Por que minha especialidade não aparece na receita?
palavras: especialidade, RQE, cabeçalho, CRM na receita

Pela Resolução CFM 2.336/2023, a especialidade só pode aparecer junto com o RQE. Em Configurações > Minha equipe, no seu perfil, preencha a especialidade e o RQE. O CRM com UF também é preenchido ali.

## Como mudo o cabeçalho e a logo dos documentos?
palavras: logo, cabeçalho, endereço na receita, dados da clínica

Em Configurações > Minha clínica: envie a logo (até 2 MB) e preencha nome, CNPJ ou CPF e endereço. Esses dados aparecem no cabeçalho de receitas, atestados e demais documentos.

## Onde vejo os documentos já emitidos?
palavras: histórico de receitas, reenviar documento, baixar documento

Na tela Receitas e Atestados. Busque pelo paciente ou tipo, filtre por período e, em cada documento, veja, baixe ou reenvie ao paciente. O status da assinatura digital aparece em cada um.

## Como preencho uma LME?
palavras: LME, medicamento de alto custo, componente especializado, laudo, CNES

Na consulta, escolha LME no menu de documentos. O sistema preenche primeiro com os cadastros (paciente, médico e estabelecimento), depois com peso e altura da triagem mais recente e, por último, a IA completa o que ainda falta a partir do prontuário. Cada campo mostra a origem do dado para você revisar. Ao emitir, os campos vazios do cadastro (como nome da mãe, raça/cor e CNS) são completados, mas valores já existentes nunca são trocados.

## Como cadastro o estabelecimento (CNES) da LME?
palavras: CNES, estabelecimento, unidade de saúde, campo 1 da LME

Em Configurações > Minha clínica, cadastre os estabelecimentos pelo número do CNES (o sistema busca os dados no Ministério da Saúde) e marque um como padrão. Se seu consultório não tem CNES próprio, cadastre o estabelecimento público onde você emite a LME.

## Quais documentos o paciente precisa levar com a LME?
palavras: checklist LME, documentos LME, secretaria de saúde

A tela da LME mostra uma lista de documentos de acordo com o estado do endereço do paciente (ou da clínica), com a fonte oficial de cada regra. Para estados ainda não levantados, aparece a lista federal com um aviso. Os anexos enviados ficam marcados com o nome do documento.
