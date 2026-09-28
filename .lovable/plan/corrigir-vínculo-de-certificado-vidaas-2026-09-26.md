# Corrigir vínculo de certificado VIDaaS

## Alterações
- Capturar o campo `token` retornado pelo Integra BRy ao criar o vínculo e armazená-lo como a credencial `X-API-KEY` da sessão.
- Remover o uso incorreto do `state` como credencial; o `state` continuará servindo apenas para localizar e validar a sessão de retorno.
- Aceitar os nomes usuais de produção em `BRY_ENV` (`prod`, `production` e `producao`) para impedir chamadas acidentais ao ambiente de homologação.
- Melhorar o tratamento do retorno: enquanto a autenticação ainda estiver pendente, responder sem transformar isso em erro interno; em falhas reais, preservar uma mensagem útil sem expor credenciais.
- Remover o log temporário que registra a resposta bruta contendo o token do vínculo.

## Validação
- Conferir a compilação e os registros do servidor.
- Validar que um novo vínculo VIDaaS persiste o token retornado e consulta `/auth/info` e `/auth/certificate` com essa credencial, nunca com o `state`.

## Observação
- O vínculo que já falhou precisa ser iniciado novamente, pois a sessão anterior foi criada sem armazenar a credencial retornada pela BRy.
