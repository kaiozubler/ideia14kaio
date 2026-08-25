-- Cada upload de documento (ou texto colado) é dividido em vários chunks,
-- e cada chunk vira uma linha própria em base_conhecimento_itens. Isso é um
-- detalhe interno de implementação (limite de tamanho por chamada de busca),
-- mas hoje o front-end lista cada chunk como um item separado na tela — o
-- médico vê um mesmo documento repetido várias vezes, com o mesmo nome.
--
-- grupo_id identifica quais linhas vieram do mesmo upload/texto colado, pra
-- o front-end agrupar a exibição em "1 documento = 1 linha na tela" e a
-- exclusão apagar o documento inteiro de uma vez, não chunk por chunk.
alter table public.base_conhecimento_itens
  add column if not exists grupo_id text;

-- Itens já existentes não têm como saber quais chunks vieram do mesmo
-- upload (essa informação não era guardada antes). Cada um vira seu próprio
-- grupo (usando o próprio id), o que preserva o comportamento atual pra
-- dados antigos: eles continuam aparecendo como itens avulsos até serem
-- reenviados.
update public.base_conhecimento_itens
  set grupo_id = id::text
  where grupo_id is null;
