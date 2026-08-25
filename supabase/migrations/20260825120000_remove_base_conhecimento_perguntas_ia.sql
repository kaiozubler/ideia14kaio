-- Remove a geração de "perguntas relacionadas" por chunk na base de
-- conhecimento (introduzida em 20260821090000_base_conhecimento_perguntas_ia.sql).
--
-- Motivo: a ideia original era usar essas perguntas como ponte de vocabulário
-- na busca (FTS sobre conteudo + perguntas_relacionadas). Mas a migração
-- 20260822122053_67cc09c7-674a-4cf0-b594-3919d1c85e91.sql reescreveu
-- buscar_base_conhecimento para usar apenas similaridade de texto (pg_trgm)
-- sobre a coluna `conteudo`, sem nunca voltar a usar `perguntas_relacionadas`.
-- Desde então a coluna era escrita a cada upload de documento (custando uma
-- chamada de IA por lote de 6 chunks) e nunca lida em lugar nenhum — nem na
-- busca, nem na UI (o SELECT em base-conhecimento.js nem inclui a coluna).
--
-- O índice base_conhecimento_itens_fts (GIN sobre to_tsvector) também ficou
-- órfão pelo mesmo motivo: nenhuma query usa mais busca FTS nessa tabela,
-- só similaridade de trigrama. Como ele inclui perguntas_relacionadas na
-- expressão indexada, precisa ser removido antes de dropar a coluna.

drop index if exists public.base_conhecimento_itens_fts;

alter table public.base_conhecimento_itens
  drop column if exists perguntas_relacionadas;
