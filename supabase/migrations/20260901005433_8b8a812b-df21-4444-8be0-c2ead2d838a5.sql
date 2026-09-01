CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  wa_from text not null,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  content text,
  wa_message_id text,
  created_at timestamptz not null default now()
);
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;