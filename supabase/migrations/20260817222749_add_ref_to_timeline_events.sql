-- Permite que um evento de timeline aponte de volta pra um registro de origem
-- (ex.: a resposta de um questionário), possibilitando um botão "Ver X" no
-- item da timeline. Genérico o bastante pra outras features reaproveitarem.
alter table public.timeline_events
  add column if not exists ref_type text,
  add column if not exists ref_id uuid;

create index if not exists idx_timeline_events_ref on public.timeline_events(ref_type, ref_id);
