-- Copiloto ativo: a IA acompanha a consulta e traz sugestões sozinha a cada
-- ciclo (chamadas automáticas a /api/chat-ia). Incluído no plano Pro,
-- adicional opcional no Enterprise (cobrado por consulta da franquia de
-- Copiloto, ver src/lib/plans/config.ts) e fora do Basic, que fica reativo.
--
-- O direito vale por plano + esta coluna (copilotoAtivoLiberado no código):
-- só no Enterprise a coluna decide; no Pro é sempre verdadeiro.

alter table public.contratacoes
  add column if not exists copiloto_ativo boolean not null default false;

alter table public.assinaturas
  add column if not exists copiloto_ativo boolean not null default false;

-- Pro inclui. Enterprise que já existia mantém o modo ativo (decisão de
-- produto em 2026-11-06); novas contratações Enterprise escolhem o adicional.
update public.assinaturas
   set copiloto_ativo = true
 where plano in ('pro', 'enterprise')
   and copiloto_ativo = false;
