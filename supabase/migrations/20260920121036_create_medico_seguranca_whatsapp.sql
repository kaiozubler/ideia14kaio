-- Segunda camada de segurança para o canal Médico x assistente_ai pelo
-- WhatsApp: além do telefone já vinculado à conta, o médico define uma
-- palavra-chave que é exigida periodicamente através de um desafio de
-- blocos de letras (nunca pedida/exibida por completo).
--
-- palavra_chave_cifrada: nunca gravada em texto puro — cifrada com o mesmo
-- helper AES-GCM já usado em signature_pkce_sessions (SIGNATURE_ENCRYPTION_KEY).
--
-- blocos_usados: histórico das combinações de blocos já usadas nos desafios,
-- para nunca repetir a mesma combinação — zera sempre que a palavra-chave
-- é trocada.
--
-- desafio_ativo: estado do desafio em andamento (blocos mostrados, quais são
-- os corretos, tentativas already feitas) — null quando não há desafio pendente.
CREATE TABLE IF NOT EXISTS public.medico_seguranca_whatsapp (
  id_medico uuid primary key references auth.users(id) on delete cascade,
  palavra_chave_cifrada text,
  palavra_chave_criada_em timestamptz,
  palavra_chave_usos integer not null default 0,
  frequencia_horas integer not null default 24
    check (frequencia_horas in (6, 12, 24, 36)),
  ultima_autenticacao_em timestamptz,
  blocos_usados jsonb not null default '[]'::jsonb,
  desafio_ativo jsonb,
  desafio_bloqueado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT ALL ON public.medico_seguranca_whatsapp TO service_role;
ALTER TABLE public.medico_seguranca_whatsapp ENABLE ROW LEVEL SECURITY;

-- Tabela de uso exclusivo do servidor (rota de API com service_role, e o
-- webhook do WhatsApp) — mesmo padrão de whatsapp_messages. O cliente nunca
-- lê/escreve essa tabela diretamente; a rota de API valida a sessão do
-- médico via Bearer token antes de tocar nela.
CREATE POLICY "medico_seguranca_whatsapp server only"
  ON public.medico_seguranca_whatsapp
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
