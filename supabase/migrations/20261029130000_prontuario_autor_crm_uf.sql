-- O autor gravado em prontuario_versoes levava o CRM de raw_user_meta_data->>'crm',
-- mas Minha equipe grava o CRM do médico em crm_numero/crm_uf. Sem isso, cada
-- versão saía só com o nome, sem o CRM/UF que a Res. CFM 1.638/2002 exige.
create or replace function public.prontuario_nome_autor(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.nome || coalesce(' (' || nullif(btrim(m.registro), '') || ')', '')
       from public.clinica_membros m where m.user_id = uid and m.status = 'ativo' limit 1),
    (select coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''), u.email)
            || coalesce(' — CRM ' || coalesce(
                 nullif(btrim(u.raw_user_meta_data->>'crm_numero'), '')
                   || coalesce('/' || nullif(btrim(u.raw_user_meta_data->>'crm_uf'), ''), ''),
                 nullif(btrim(u.raw_user_meta_data->>'crm'), '')), '')
       from auth.users u where u.id = uid),
    'Sistema'
  );
$$;

revoke all on function public.prontuario_nome_autor(uuid) from public, anon, authenticated;
