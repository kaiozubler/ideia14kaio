---
description: Atualiza a base de ajuda (FAQ do Assistente IA) só com o que mudou desde a última revisão
---

Atualize a base de ajuda do MediCopilot em `docs/ajuda/` (formato em `docs/ajuda/README.md`).

1. Rode `git fetch origin main` e, se a branch atual não for a main, considere as mudanças até `origin/main` (`--ate origin/main`).
2. Rode `node scripts/base-ajuda.mjs pendencias --prompt` (acrescente `--ate origin/main` se for o caso) e siga o texto que ele imprimir. Se disser "Nada novo", pare aqui e avise.
3. Para cada tema listado, leia o diff dos arquivos indicados e o tema atual. Corrija respostas que ficaram erradas, acrescente perguntas para o que o usuário passou a poder fazer e remova o que deixou de existir. Ignore mudanças internas sem efeito na tela ou no uso.
4. Para "Arquivos alterados que nenhum tema cobre": se for uma funcionalidade visível, acrescente o caminho em `fontes` de um tema ou crie um tema novo; senão, ignore.
5. Rode `node scripts/base-ajuda.mjs validar` até passar e depois `node scripts/base-ajuda.mjs marcar` (com o mesmo `--ate` do passo 2).
6. Mostre um resumo do que mudou por tema. Não faça commit sem eu pedir.

O conteúdo publicado chega ao assistente sozinho no próximo deploy (sincronização por hash em `src/lib/ajuda/sincronizar.server.ts`).

$ARGUMENTS
