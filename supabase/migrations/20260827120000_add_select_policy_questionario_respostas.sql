-- Corrige uma lacuna de RLS: public.questionario_respostas e
-- public.questionario_resposta_itens têm row level security habilitado desde
-- 20260816154348_create_questionarios.sql, mas NUNCA receberam uma policy de
-- SELECT para "authenticated" (só existiam policies de INSERT para o público
-- anônimo responder formulários, hoje inclusive já revogadas/movidas para o
-- servidor em 20260817113241). Na prática isso significa que o médico logado
-- não conseguia ler as respostas dos próprios questionários — nem na tela
-- "Questionário" (Respostas recebidas / Ver respostas), nem no novo contexto
-- de respostas de questionário usado pelo chat_ai no cadastro do paciente.
--
-- Segue o mesmo padrão de "dono do registro" já usado para
-- public.questionarios / public.questionario_perguntas em
-- 20260818202719_fix_rls_questionarios.sql: o médico só enxerga respostas de
-- questionários que ele mesmo criou (questionarios.user_id = auth.uid()).

grant select on public.questionario_respostas to authenticated;
grant select on public.questionario_resposta_itens to authenticated;

drop policy if exists "Medicos leem respostas dos seus questionarios" on public.questionario_respostas;
create policy "Medicos leem respostas dos seus questionarios"
  on public.questionario_respostas for select to authenticated
  using (
    exists (
      select 1 from public.questionarios q
      where q.id = questionario_respostas.questionario_id
        and q.user_id = auth.uid()
    )
  );

drop policy if exists "Medicos leem itens de resposta dos seus questionarios" on public.questionario_resposta_itens;
create policy "Medicos leem itens de resposta dos seus questionarios"
  on public.questionario_resposta_itens for select to authenticated
  using (
    exists (
      select 1
      from public.questionario_respostas r
      join public.questionarios q on q.id = r.questionario_id
      where r.id = questionario_resposta_itens.resposta_id
        and q.user_id = auth.uid()
    )
  );
