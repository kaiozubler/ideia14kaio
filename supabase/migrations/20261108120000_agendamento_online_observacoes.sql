-- Agendamento online: o paciente pode escrever o objetivo da consulta ou
-- informações para a clínica (opcional, até 500 caracteres), gravado em
-- agendamentos.observacoes. Troca a assinatura de agenda_publica_reservar; o
-- parâmetro novo tem default, então quem ainda chama sem ele continua igual.

drop function if exists public.agenda_publica_reservar(text, uuid, timestamptz, text, text, text, text, text);

-- Reserva pública, chamada só pelo servidor depois de conferir que o horário
-- pertence à grade. O lock por clínica serializa as reservas: duas pessoas
-- no mesmo horário não passam juntas pela checagem de conflito. Erros voltam
-- como {erro: ...} em vez de exception para a tentativa gravada não ser
-- desfeita junto com a transação.
create or replace function public.agenda_publica_reservar(
  p_token text,
  p_medico_id uuid,
  p_inicio timestamptz,
  p_nome text,
  p_cpf text,
  p_telefone text,
  p_email text,
  p_ip_hash text,
  p_observacoes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.agenda_online_config;
  med public.agenda_medicos;
  fim timestamptz;
  cpf_digitos text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  cpf_formatado text;
  pac uuid;
  novo_id uuid;
  rotulo_especialidade text;
begin
  select * into cfg from public.agenda_online_config where token = p_token and ativo;
  if cfg.clinica_id is null then
    return jsonb_build_object('erro', 'link_indisponivel');
  end if;
  select * into med from public.agenda_medicos where id = p_medico_id and clinica_id = cfg.clinica_id and ativo;
  if med.id is null then
    return jsonb_build_object('erro', 'horario_indisponivel');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agenda_online:' || cfg.clinica_id::text, 0));

  if p_ip_hash is not null then
    delete from public.agenda_online_tentativas
     where clinica_id = cfg.clinica_id and criado_em < now() - interval '1 day';
    insert into public.agenda_online_tentativas (clinica_id, ip_hash) values (cfg.clinica_id, p_ip_hash);
    if (select count(*) from public.agenda_online_tentativas
         where clinica_id = cfg.clinica_id and ip_hash = p_ip_hash and criado_em > now() - interval '1 hour') > 10 then
      return jsonb_build_object('erro', 'muitas_tentativas');
    end if;
  end if;

  fim := p_inicio + make_interval(mins => med.duracao_min);
  if exists (
    select 1 from public.agendamentos a
     where a.id_medico = cfg.clinica_id
       and coalesce(lower(a.status), 'agendado') not in ('cancelado', 'reagendado')
       and (a.agenda_medico_id = med.id or a.agenda_medico_id is null)
       and tstzrange(a.data_hora, a.data_hora + make_interval(mins => a.duracao_min)) && tstzrange(p_inicio, fim)
  ) then
    return jsonb_build_object('erro', 'horario_ocupado');
  end if;

  cpf_formatado := substr(cpf_digitos, 1, 3) || '.' || substr(cpf_digitos, 4, 3) || '.'
    || substr(cpf_digitos, 7, 3) || '-' || substr(cpf_digitos, 10, 2);

  if (select count(*) from public.agendamentos a
       where a.id_medico = cfg.clinica_id
         and a.origem = 'link_publico'
         and a.cpf = cpf_digitos
         and a.data_hora > now()
         and coalesce(lower(a.status), 'agendado') not in ('cancelado', 'reagendado')) >= 3 then
    return jsonb_build_object('erro', 'limite_cpf');
  end if;

  -- Paciente existente nunca é alterado por este link: quem digita um CPF não
  -- prova ser o dono dele. A resposta é a mesma para paciente novo ou antigo.
  select p.paciente_id into pac from public.pacientes p
   where p.user_id = cfg.clinica_id and p.cpf in (cpf_digitos, cpf_formatado) limit 1;
  if pac is null then
    insert into public.pacientes (user_id, name, cpf, telefone, email, medico, convenio)
    values (cfg.clinica_id, btrim(p_nome), cpf_formatado, p_telefone, nullif(btrim(coalesce(p_email, '')), ''), med.nome, 'Particular')
    returning paciente_id into pac;
  end if;

  rotulo_especialidade := case when nullif(btrim(med.rqe), '') is not null then nullif(btrim(med.especialidade), '') end;

  insert into public.agendamentos (
    id_medico, agenda_medico_id, paciente_id, paciente_nome, data_hora, duracao_min, status, motivo,
    origem, tipo, especialidade, medico_nome, telefone, cpf, modalidade, observacoes
  ) values (
    cfg.clinica_id, med.id, pac, btrim(p_nome), p_inicio, med.duracao_min, 'agendado',
    'Consulta' || coalesce(' — ' || rotulo_especialidade, ''),
    'link_publico', 'Consulta', rotulo_especialidade, med.nome, p_telefone, cpf_digitos, 'presencial',
    nullif(btrim(left(coalesce(p_observacoes, ''), 500)), '')
  )
  returning id into novo_id;

  return jsonb_build_object('id', novo_id);
end;
$$;

revoke all on function public.agenda_publica_reservar(text, uuid, timestamptz, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.agenda_publica_reservar(text, uuid, timestamptz, text, text, text, text, text, text) to service_role;
