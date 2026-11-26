# Base de ajuda do MediCopilot

Perguntas e respostas sobre o uso do app, em linguagem simples. É daqui que o
Assistente IA (e o chat de dúvidas da página de planos) tira as respostas
quando alguém pergunta "como faço…?".

## Como o conteúdo chega ao assistente

1. Cada arquivo `*.md` desta pasta (menos este README) é um tema.
2. Cada título `## ` dentro dele é **uma pergunta**, e o texto abaixo é a resposta.
3. No deploy, o servidor compara o conteúdo daqui com a tabela
   `base_conhecimento_sistema_itens` e grava só o que mudou (por hash). Itens
   apagados daqui ficam inativos. Ninguém precisa rodar nada no banco.

Itens criados à mão no banco (`origem = 'manual'`) nunca são tocados pela sincronização.

## Formato de um tema

```markdown
---
titulo: Agenda
fontes: public/agendamento-online.js, src/routes/api/agendamento/
---

## Como marco uma consulta?
palavras: agendar, marcar, horário

Resposta curta, em passos, sem termos técnicos.
```

- `titulo`: nome da área, aparece junto da pergunta para o assistente.
- `fontes`: arquivos ou pastas do código que, se mudarem, podem deixar o tema
  desatualizado (prefixo de caminho, separado por vírgula).
- `palavras:` (opcional, logo abaixo da pergunta): sinônimos e termos que o
  usuário costuma digitar e que não aparecem na resposta.

Boas práticas: uma dúvida por título, frases curtas, nome dos botões entre
aspas exatamente como aparecem na tela, sem preços (o chat de planos lê os
preços direto de `src/lib/plans/config.ts`) e sem detalhes internos de
segurança.

## Rotina de atualização

O arquivo `_revisao.json` guarda o último commit cuja mudança já foi refletida
aqui. Para ver o que mudou no app desde então:

```bash
node scripts/base-ajuda.mjs pendencias
```

Ele lista os commits novos (e os PRs, se o `gh` estiver logado), agrupa por
tema afetado pelas `fontes` e mostra arquivos alterados que nenhum tema cobre.
Com `--prompt`, gera um texto pronto para colar no Claude Code. Depois de
atualizar os temas:

```bash
node scripts/base-ajuda.mjs validar
```

```bash
node scripts/base-ajuda.mjs marcar
```

`validar` confere o formato (perguntas repetidas, respostas vazias, fontes que
não existem) e `marcar` registra o commit atual como revisado. No Claude Code,
o comando `/atualizar-ajuda` faz as três etapas.
