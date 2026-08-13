-- A migration 20260810170157 adicionou uma nova versão de buscar_tuss com
-- 5 parâmetros (termo, p_tabela, p_limit, p_usar_alias, p_user_id) usando
-- CREATE OR REPLACE FUNCTION. Como o número de parâmetros mudou, o Postgres
-- não substituiu a função original de 3 parâmetros — criou uma SEGUNDA
-- função sobrecarregada (overload) com o mesmo nome. A partir daí, toda
-- chamada via RPC do Supabase (que usa notação nomeada: termo := ...,
-- p_tabela := ..., p_limit := ...) ficou ambígua, porque as duas funções
-- são candidatas válidas quando os parâmetros extras têm DEFAULT. O Postgres
-- rejeita a chamada com "function name is not unique" — e como a rota
-- /api/tuss/buscar não checava res.ok no client, esse erro 500 aparecia
-- silenciosamente como "nenhum resultado" para o médico.
--
-- Solução: remover a função antiga de 3 parâmetros e manter só a versão
-- mais recente (5 parâmetros, com suporte a alias por médico).
DROP FUNCTION IF EXISTS public.buscar_tuss(text, text, integer);

REVOKE ALL ON FUNCTION public.buscar_tuss(text, text, integer, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_tuss(text, text, integer, boolean, uuid) TO authenticated, service_role;
