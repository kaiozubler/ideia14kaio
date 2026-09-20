# Copiloto pelo WhatsApp — nova sessão

## Objetivo
Adicionar à tela Copiloto um card para configurar e acompanhar a palavra-chave de segurança do WhatsApp, usando exclusivamente a API existente.

## Implementação
- Criar um card no mesmo padrão visual dos demais, com o título “Copiloto pelo WhatsApp (Nova sessão)”.
- Adicionar campo protegido para a nova palavra-chave, opção de exibir/ocultar, contador e validação visual em tempo real:
  - mínimo de 12 letras;
  - somente letras;
  - nenhuma letra repetida mais de duas vezes.
- Adicionar seletor de frequência com 6h, 12h, 24h e 36h.
- Ao abrir a tela Copiloto, consultar `GET /api/whatsapp/seguranca` usando o token da sessão autenticada no cabeçalho.
- Exibir apenas os metadados retornados: idade da configuração em dias, quantidade de usos, frequência e situação de bloqueio. A palavra-chave nunca será preenchida nem mostrada novamente.
- Exibir aviso destacado quando a troca estiver próxima e alerta mais forte quando a troca for obrigatória.
- No botão “Salvar”, enviar `POST /api/whatsapp/seguranca` com a nova palavra-chave e frequência, usando o mesmo token autenticado; após sucesso, limpar o campo e atualizar o status.
- Tratar carregamento, sessão ausente e erros sem interferir nas configurações locais já existentes do Copiloto.

## Fora do escopo
- Nenhuma tabela, migração, criptografia ou alteração na API existente.

## Validação
- Conferir o card em telas largas e estreitas.
- Validar os estados: não configurado, configurado, aviso de rotação, troca obrigatória e bloqueado.
- Confirmar que nenhuma palavra-chave é persistida no navegador ou reapresentada pela interface.
