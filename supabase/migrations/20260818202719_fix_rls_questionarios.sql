-- Corrige a causa raiz do bug "edito o questionário e o link público não
-- atualiza / perguntas antigas continuam aparecendo".
--
-- A migration que criou public.questionarios / public.questionario_perguntas
-- (20260816154348_create_questionarios.sql) ligou ROW LEVEL SECURITY mas
-- nunca criou as policies para "authenticated" — ficou só um comentário
-- pedindo pra replicar o padrão já usado em "protocolos". Sem uma policy
-- simétrica (SELECT/INSERT/UPDATE/DELETE), qualquer UPDATE/DELETE feito pelo
-- médico ao editar um questionário pode ser silenciosamente ignorado pelo
-- Postgres (RLS não gera erro em UPDATE/DELETE sem match — apenas afeta 0
-- linhas), fazendo perguntas antigas ficarem "fantasmas" no banco junto com
-- as novas. É isso que o link público (RPC formulario_publico, que lê
-- diretamente da tabela) acaba exibindo.
--
-- Esta migration fecha essa lacuna, replicando o padrão exato já usado em
-- public.protocolos / public.protocolo_cids:
--   1) garante a coluna user_id (dono do registro) nas duas tabelas;
--   2) faz backfill de user_id em questionario_perguntas a partir do
--      questionário pai, para linhas antigas que tenham ficado sem dono;
--   3) cria GRANT + policy "FOR ALL" (SELECT/INSERT/UPDATE/DELETE) para
--      authenticated, restrita ao dono do registro.
-- É idempotente: pode ser reaplicada sem quebrar nada.

-- 1) Coluna de dono, se ainda não existir.
alter table public.questionarios
  add column if not exists user_id uuid not null default auth.uid();

alter table public.questionario_perguntas
  add column if not exists user_id uuid;

-- 2) Backfill para linhas antigas que tenham ficado sem user_id.
update public.questionario_perguntas p
set user_id = q.user_id
from public.questionarios q
where p.questionario_id = q.id and p.user_id is null;

alter table public.questionario_perguntas
  alter column user_id set default auth.uid();

-- Garante que toda pergunta nova sempre tenha o mesmo dono do questionário
-- pai, mesmo que o client não envie user_id explicitamente.
create or replace function public.sincronizar_user_id_pergunta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    select user_id into new.user_id from public.questionarios where id = new.questionario_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sincronizar_user_id_pergunta on public.questionario_perguntas;
create trigger trg_sincronizar_user_id_pergunta
  before insert on public.questionario_perguntas
  for each row execute function public.sincronizar_user_id_pergunta();

-- 3) Grants + policy simétrica para authenticated (mesmo padrão de protocolos).
grant select, insert, update, delete on public.questionarios to authenticated;
grant all on public.questionarios to service_role;

grant select, insert, update, delete on public.questionario_perguntas to authenticated;
grant all on public.questionario_perguntas to service_role;

drop policy if exists "Medicos gerenciam seus questionarios" on public.questionarios;
create policy "Medicos gerenciam seus questionarios"
  on public.questionarios for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Medicos gerenciam perguntas dos seus questionarios" on public.questionario_perguntas;
create policy "Medicos gerenciam perguntas dos seus questionarios"
  on public.questionario_perguntas for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
