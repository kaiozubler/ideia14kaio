## Avaliação

Concordo com a mudança. Hoje o usuário precisa lembrar de inserir tokens como `{resumo_prontuario}`, `{info_complementar}` ou `{ultimos_exames}` no meio do texto — é técnico, frágil (se esquecer o token o dado não vai) e expõe um detalhe de implementação que não agrega valor clínico. Trocar por **Fontes de Contexto** (checkboxes) deixa o médico focado no que quer pedir à IA, e o sistema cuida de montar o pacote de dados.

## Fontes de Contexto propostas

Na tela de Novo/Editar prompt, no lugar da régua de "Variáveis do sistema", passa a existir uma lista de toggles "Fontes de contexto que a IA pode usar":

1. **Dados cadastrais do paciente** — nome, nascimento, idade, sexo, telefone, convênio, CPF, endereço, filiação.
2. **Dados complementares do paciente** — campos de `infoComp` (alergias, medicações em uso, antecedentes, etc.).
3. **Resumo do prontuário** — `currentResumoProntuario`.
4. **Resumo dos exames** — últimos exames cadastrados do paciente.
5. **Resumo do atendimento atual** — anotações do prontuário em aberto + transcrição + bolhas do Copiloto + itens fixados.
6. **Memória longitudinal do paciente** — placeholder por enquanto (fonte cinza/"em breve"), pronta para ligar quando o recurso existir.

Todas vêm ligadas por padrão, exceto Memória longitudinal (desativada e desabilitada com tag "Em breve").

## Mudanças na UI

- **Modal "Novo/Editar prompt de anamnese"** (`#m-anamnese-prompt`):
  - Remover o bloco "Variáveis do sistema (clique para inserir)" e o `#map-vars`.
  - Adicionar um bloco "Fontes de contexto" com 6 checkboxes + breve descrição de cada um.
  - Atualizar o placeholder/`label` do textarea para "Escreva apenas as instruções para a IA. Os dados marcados acima serão fornecidos automaticamente.".
- **Lista de modelos** (`renderAnamneseList`): mostrar pequenos chips com as fontes ativas em cada modelo.
- **Modelo padrão**: reescrever o `DEFAULT_ANAMNESE_PROMPT` removendo os tokens `{...}` e deixando apenas instruções, já que o contexto vem agora por fontes.

## Mudanças no comportamento

- Modelo passa a guardar `sources: { cadastrais, complementares, prontuario, exames, atendimento, longitudinal }` em `localStorage` (`anamnese_models`).
- `buildAnamneseContext()` permanece, mas ganha um irmão `buildAnamneseContextBlock(sources)` que monta um bloco de texto só com as seções marcadas, em formato Markdown com cabeçalhos claros (`## Dados cadastrais`, `## Resumo do prontuário`, etc.).
- `runAnamneseGeneration()` deixa de chamar `applyAnamneseVars` e passa a montar o `system_prompt` como: `model.prompt` + `\n\n---\nContexto disponível:\n` + bloco gerado pelas fontes selecionadas. Fontes não selecionadas não vão à IA — preserva a regra atual de "só envia o que foi configurado".
- `applyAnamneseVars` e `ANAMNESE_VARS` ficam mantidos apenas como compatibilidade para modelos antigos que ainda contenham `{tokens}` (substituição silenciosa), evitando quebrar prompts já salvos pelo usuário.

## Migração de modelos existentes

Na primeira carga após a mudança (`loadAnamneseModels`), para cada modelo sem campo `sources`:
- Inferir as fontes a partir dos tokens presentes no texto (`{resumo_prontuario}` → prontuário, `{info_complementar}` → complementares, `{ultimos_exames}` → exames, `{paciente_*}` → cadastrais, etc.).
- Se nenhum token for encontrado, marcar todas as 5 fontes ativas (exceto longitudinal) como padrão seguro.
- Persistir o modelo já com `sources` preenchido.

## Memória longitudinal

Fica como ponto de extensão: checkbox desabilitado com tooltip "Em breve — histórico consolidado de longo prazo do paciente". Quando o recurso for criado, basta produzir um texto resumido e plugar em `buildAnamneseContextBlock` sob a chave `longitudinal`.

## Fora de escopo desta entrega

- Criar de fato a Memória longitudinal (estrutura de dados, geração e atualização).
- Reescrever a tela de Anamnese gerada (painel lateral) — segue igual.
