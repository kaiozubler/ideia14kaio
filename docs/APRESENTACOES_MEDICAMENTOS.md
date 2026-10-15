# Apresentações legíveis de medicamentos

O texto de apresentação da Anvisa (ex.: `50 MG COM REV CT BL AL PVC/PE/PVDC BCO OPC X 15`) é
reescrito em uma versão legível para a prescrição. A reescrita é feita pelo Claude, fora do app,
e importada no catálogo compartilhado.

## Operação

Pré-requisito: o secret `CATALOGO_ADMIN_TOKEN` definido no app (Lovable › Secrets) e o mesmo
valor em `.env.local` na raiz do repositório.

1. `node scripts/apresentacoes.mjs exportar 500 pendentes.json` — baixa até 500 apresentações
   distintas sem versão legível.
2. O Claude escreve `traduzidas.json` seguindo as regras abaixo:
   `[{"apresentacao": "<original exato>", "texto_simplificado": "...", "posologia_padrao": "..."}]`
3. `node scripts/apresentacoes.mjs importar traduzidas.json` — grava em `apresentacao_legivel`
   e propaga para `medicamentos.apresentacao_simplificada` / `posologia_padrao`.

O servidor recusa qualquer texto que contenha um número ausente do original.

## Regras de reescrita

Não alterar nenhum valor, dose, concentração, unidade ou quantidade; não buscar nada externo
nem inventar nada: apenas traduzir as abreviações e organizar o que já está no texto.

Formato: `<concentração> — <forma farmacêutica>, <embalagem/quantidade>`

- `50 MG COM REV CT BL AL PVC/PE/PVDC BCO OPC X 15` → `50 mg — comprimido revestido, caixa com 15`
- `(50+ 12,5) MG COM REV CT BL AL PLAS OPC X 30` → `50 + 12,5 mg — comprimido revestido, caixa com 30`
- `25 U SUS INJ IM CT 1 FA VD INC X 0,5 ML` → `25 U/0,5 mL — suspensão injetável intramuscular, 1 frasco-ampola`
- `10 MG/ML SOL OR CT FR PLAS GOT X 20 ML` → `10 mg/mL — solução oral em gotas, frasco de 20 mL`

Omitir detalhes irrelevantes do material da embalagem (alumínio, PVC, âmbar, opaco).

Posologia padrão genérica, coerente apenas com a forma farmacêutica (sem dose terapêutica,
frequência clínica específica ou indicação):

- comprimido/cápsula: `1 comprimido por via oral, conforme orientação médica`
- gotas: `conforme orientação médica, por via oral (gotas)`
- injetável: `aplicar conforme orientação médica, por via intramuscular`
- creme/pomada: `aplicar na área afetada, conforme orientação médica`
