-- Equipe da clínica com login próprio (secretária e enfermeiro) e chave de
-- triagem na clínica. Decisões em AGENTS.md.
--
-- A "clínica" continua sendo a conta do médico (id_medico/user_id = uid do
-- médico). Um membro ativo enxerga os dados dessa conta só nas tabelas que
-- o papel dele precisa; prontuário, consultas, exames e documentos seguem
-- exclusivos do médico porque nenhuma política nova os toca.
--
--  clinica_membros   convite + vínculo usuário → clínica e papel
--  clinica_id()      conta da clínica do usuário logado (a própria, se médico)
--  papel_clinica()   'medico' | 'secretaria' | 'enfermeiro'
--  pacientes_cadastro  visão só com os dados cadastrais (sem dados clínicos)

CREATE TABLE IF NOT EXISTS public.clinica_membros (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  nome text not null check (length(btrim(nome)) > 0),
  papel text not null check (papel in ('secretaria', 'enfermeiro')),
  registro text,
  status text not null default 'convidado' check (status in ('convidado', 'ativo', 'inativo')),
  convite_hash text,
  convite_expira_em timestamptz,
  aceito_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS clinica_membros_email_uidx ON public.clinica_membros (clinica_id, lower(email));

-- Um login pertence a uma única clínica.
CREATE UNIQUE INDEX IF NOT EXISTS clinica_membros_user_uidx ON public.clinica_membros (user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clinica_membros_convite_uidx ON public.clinica_membros (convite_hash) WHERE convite_hash IS NOT NULL;

DROP TRIGGER IF EXISTS trg_clinica_membros_updated ON public.clinica_membros;

CREATE TRIGGER trg_clinica_membros_updated BEFORE UPDATE ON public.clinica_membros FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.clinica_membros TO authenticated;

GRANT ALL ON public.clinica_membros TO service_role;

ALTER TABLE public.clinica_membros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico ve sua equipe" ON public.clinica_membros;

CREATE POLICY "Medico ve sua equipe" ON public.clinica_membros FOR SELECT TO authenticated USING (auth.uid() = clinica_id);

DROP POLICY IF EXISTS "Membro ve o proprio vinculo" ON public.clinica_membros;

CREATE POLICY "Membro ve o proprio vinculo" ON public.clinica_membros FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Escritas só pelas funções abaixo: o papel é o que libera dados, então
-- nunca pode ser gravado direto pelo cliente.

CREATE OR REPLACE FUNCTION public.clinica_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT m.clinica_id FROM public.clinica_membros m WHERE m.user_id = auth.uid() AND m.status = 'ativo' LIMIT 1),
    auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.papel_clinica()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT m.papel FROM public.clinica_membros m WHERE m.user_id = auth.uid() AND m.status = 'ativo' LIMIT 1),
    'medico'
  );
$$;

GRANT EXECUTE ON FUNCTION public.clinica_id() TO authenticated;

GRANT EXECUTE ON FUNCTION public.papel_clinica() TO authenticated;

-- Chave de triagem da clínica (Configurações › Minha clínica).
ALTER TABLE public.medico_clinica_config ADD COLUMN IF NOT EXISTS triagem_ativa boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Equipe le a config da clinica" ON public.medico_clinica_config;

CREATE POLICY "Equipe le a config da clinica" ON public.medico_clinica_config FOR SELECT TO authenticated USING (id_medico = (SELECT public.clinica_id()));

-- Contexto do usuário logado para a interface: clínica, papel, plano e triagem.
CREATE OR REPLACE FUNCTION public.minha_clinica()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  m record;
  cid uuid;
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO m FROM public.clinica_membros WHERE user_id = uid AND status = 'ativo' LIMIT 1;
  -- Membro desativado: a interface mostra "acesso desativado" em vez de
  -- abrir o app como se fosse um médico sem pacientes.
  IF m.id IS NULL AND EXISTS (SELECT 1 FROM public.clinica_membros WHERE user_id = uid AND status = 'inativo') THEN
    RETURN json_build_object('clinica_id', uid, 'papel', 'inativo');
  END IF;
  cid := coalesce(m.clinica_id, uid);
  RETURN json_build_object(
    'clinica_id', cid,
    'papel', coalesce(m.papel, 'medico'),
    'membro_id', m.id,
    'membro_nome', m.nome,
    'registro', m.registro,
    'clinica_nome', (SELECT fantasia FROM public.medico_clinica_config WHERE id_medico = cid),
    'triagem_ativa', coalesce((SELECT triagem_ativa FROM public.medico_clinica_config WHERE id_medico = cid), true),
    'plano_pago', EXISTS (SELECT 1 FROM public.assinaturas WHERE medico_id = cid AND status <> 'cancelada')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.minha_clinica() TO authenticated;

/* ---------- convites ---------- */

CREATE OR REPLACE FUNCTION public.clinica_convidar(p_email text, p_nome text, p_papel text, p_registro text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  limite integer;
  ocupados integer;
  existente record;
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  email_norm text := lower(btrim(p_email));
BEGIN
  IF uid IS NULL OR public.papel_clinica() <> 'medico' THEN
    RAISE EXCEPTION 'Só o médico responsável pode convidar a equipe.' USING ERRCODE = '42501';
  END IF;
  IF p_papel NOT IN ('secretaria', 'enfermeiro') THEN
    RAISE EXCEPTION 'Função inválida.' USING ERRCODE = '22023';
  END IF;
  IF email_norm = lower(coalesce(auth.email(), '')) THEN
    RAISE EXCEPTION 'Use o e-mail da pessoa convidada, não o seu.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO existente FROM public.clinica_membros WHERE clinica_id = uid AND lower(email) = email_norm;
  -- Secretárias e enfermeiros ocupam as licenças de "usuários de gestão" do plano.
  limite := coalesce((SELECT secretarias FROM public.assinaturas WHERE medico_id = uid AND status <> 'cancelada' LIMIT 1), 0);
  SELECT count(*) INTO ocupados FROM public.clinica_membros
    WHERE clinica_id = uid AND status IN ('convidado', 'ativo') AND (existente.id IS NULL OR id <> existente.id);
  IF ocupados >= limite THEN
    RAISE EXCEPTION 'Seu plano permite % usuário(s) de equipe. Libere uma licença ou faça upgrade em Meu plano.', limite USING ERRCODE = 'P0001';
  END IF;
  IF existente.id IS NOT NULL THEN
    IF existente.status = 'ativo' THEN
      RAISE EXCEPTION 'Esta pessoa já faz parte da equipe.' USING ERRCODE = '23505';
    END IF;
    UPDATE public.clinica_membros SET
      nome = btrim(p_nome), papel = p_papel, registro = nullif(btrim(coalesce(p_registro, '')), ''),
      status = CASE WHEN user_id IS NULL THEN 'convidado' ELSE 'ativo' END,
      convite_hash = CASE WHEN user_id IS NULL THEN encode(sha256(convert_to(token, 'UTF8')), 'hex') END,
      convite_expira_em = CASE WHEN user_id IS NULL THEN now() + interval '7 days' END
    WHERE id = existente.id;
    IF existente.user_id IS NOT NULL THEN
      RETURN NULL; -- reativado: já tem login, não precisa de link
    END IF;
  ELSE
    INSERT INTO public.clinica_membros (clinica_id, email, nome, papel, registro, convite_hash, convite_expira_em)
    VALUES (uid, email_norm, btrim(p_nome), p_papel, nullif(btrim(coalesce(p_registro, '')), ''),
      encode(sha256(convert_to(token, 'UTF8')), 'hex'), now() + interval '7 days');
  END IF;
  RETURN token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clinica_convidar(text, text, text, text) TO authenticated;

-- Tela de login com ?convite=: mostra para qual clínica e função é o convite.
CREATE OR REPLACE FUNCTION public.convite_info(p_token text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'clinica_nome', coalesce((SELECT fantasia FROM public.medico_clinica_config c WHERE c.id_medico = m.clinica_id), 'a clínica'),
    'papel', m.papel,
    'nome', m.nome,
    'email', m.email,
    'valido', m.status = 'convidado' AND m.convite_expira_em > now()
  )
  FROM public.clinica_membros m
  WHERE m.convite_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

GRANT EXECUTE ON FUNCTION public.convite_info(text) TO anon, authenticated;

-- Aceitar exige o link (token) E estar logado com o e-mail convidado.
CREATE OR REPLACE FUNCTION public.convite_aceitar(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  m record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Entre com sua conta para aceitar o convite.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.clinica_membros
    WHERE convite_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    FOR UPDATE;
  IF m.id IS NULL OR m.status <> 'convidado' OR m.convite_expira_em <= now() THEN
    RAISE EXCEPTION 'Convite inválido ou expirado. Peça um novo link ao médico.' USING ERRCODE = 'P0001';
  END IF;
  IF lower(m.email) <> lower(coalesce(auth.email(), '')) THEN
    RAISE EXCEPTION 'Este convite é para %. Entre com esse e-mail.', m.email USING ERRCODE = '42501';
  END IF;
  IF m.clinica_id = uid THEN
    RAISE EXCEPTION 'Você não pode entrar na própria equipe.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clinica_membros WHERE user_id = uid AND id <> m.id) THEN
    RAISE EXCEPTION 'Esta conta já pertence à equipe de outra clínica.' USING ERRCODE = '23505';
  END IF;
  -- Uma conta de médico com pacientes próprios deixaria de vê-los ao virar membro.
  IF EXISTS (SELECT 1 FROM public.pacientes WHERE user_id = uid) THEN
    RAISE EXCEPTION 'Esta conta já tem pacientes cadastrados como médico. Use outro e-mail para a equipe.' USING ERRCODE = '23505';
  END IF;
  UPDATE public.clinica_membros
    SET user_id = uid, status = 'ativo', aceito_em = now(), convite_hash = NULL, convite_expira_em = NULL
    WHERE id = m.id;
  RETURN json_build_object('clinica_id', m.clinica_id, 'papel', m.papel);
END;
$$;

GRANT EXECUTE ON FUNCTION public.convite_aceitar(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_membro_atualizar(p_id uuid, p_status text DEFAULT NULL, p_papel text DEFAULT NULL, p_nome text DEFAULT NULL, p_registro text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  m record;
  novo_status text;
  limite integer;
  ocupados integer;
BEGIN
  IF uid IS NULL OR public.papel_clinica() <> 'medico' THEN
    RAISE EXCEPTION 'Só o médico responsável pode alterar a equipe.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.clinica_membros WHERE id = p_id AND clinica_id = uid;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Membro não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('ativo', 'inativo') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_papel IS NOT NULL AND p_papel NOT IN ('secretaria', 'enfermeiro') THEN
    RAISE EXCEPTION 'Função inválida.' USING ERRCODE = '22023';
  END IF;
  novo_status := coalesce(p_status, m.status);
  -- Convite pendente: "inativar" cancela o link; ativar só aceitando o convite.
  IF m.status = 'convidado' AND novo_status = 'ativo' THEN
    novo_status := 'convidado';
  END IF;
  IF novo_status = 'ativo' AND m.status = 'inativo' THEN
    IF m.user_id IS NULL THEN
      RAISE EXCEPTION 'Este convite não foi aceito. Gere um novo link.' USING ERRCODE = 'P0001';
    END IF;
    limite := coalesce((SELECT secretarias FROM public.assinaturas WHERE medico_id = uid AND status <> 'cancelada' LIMIT 1), 0);
    SELECT count(*) INTO ocupados FROM public.clinica_membros WHERE clinica_id = uid AND status IN ('convidado', 'ativo');
    IF ocupados >= limite THEN
      RAISE EXCEPTION 'Seu plano permite % usuário(s) de equipe.', limite USING ERRCODE = 'P0001';
    END IF;
  END IF;
  UPDATE public.clinica_membros SET
    status = novo_status,
    convite_hash = CASE WHEN novo_status = 'inativo' THEN NULL ELSE convite_hash END,
    convite_expira_em = CASE WHEN novo_status = 'inativo' THEN NULL ELSE convite_expira_em END,
    papel = coalesce(p_papel, papel),
    nome = coalesce(nullif(btrim(coalesce(p_nome, '')), ''), nome),
    registro = CASE WHEN p_registro IS NULL THEN registro ELSE nullif(btrim(p_registro), '') END
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clinica_membro_atualizar(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_membro_remover(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.papel_clinica() <> 'medico' THEN
    RAISE EXCEPTION 'Só o médico responsável pode alterar a equipe.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.clinica_membros WHERE id = p_id AND clinica_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.clinica_membro_remover(uuid) TO authenticated;

/* ---------- pacientes: só o cadastro para a equipe ---------- */

-- Colunas de endereço já usadas pela tela de cadastro (criadas fora das migrações).
ALTER TABLE public.pacientes
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS logradouro text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS uf text;

-- Roda com o dono da visão (ignora RLS de pacientes) e filtra pela clínica do
-- usuário: a equipe nunca lê dados_clinicos, info_complementar, cids nem parentescos.
CREATE OR REPLACE VIEW public.pacientes_cadastro WITH (security_barrier = true) AS
  SELECT paciente_id, user_id, name, data_nascimento, telefone, email, mae, pai, endereco,
         cep, logradouro, numero, complemento, bairro, cidade, uf, sus,
         convenio, sexo, medico, grupo, ocupacao, cpf, created_at, updated_at
  FROM public.pacientes
  WHERE user_id = (SELECT public.clinica_id());

REVOKE ALL ON public.pacientes_cadastro FROM anon;

GRANT SELECT ON public.pacientes_cadastro TO authenticated;

CREATE OR REPLACE FUNCTION public.paciente_cadastro_salvar(p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid := public.clinica_id();
  novo uuid;
  d jsonb := coalesce(p_dados, '{}'::jsonb);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    IF coalesce(btrim(d->>'name'), '') = '' THEN
      RAISE EXCEPTION 'Informe o nome do paciente.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.pacientes (user_id, name, data_nascimento, telefone, email, mae, pai, endereco,
      cep, logradouro, numero, complemento, bairro, cidade, uf, sus, convenio, sexo, medico, grupo, ocupacao, cpf)
    VALUES (cid, btrim(d->>'name'), nullif(d->>'data_nascimento', '')::date, d->>'telefone', d->>'email', d->>'mae', d->>'pai',
      d->>'endereco', d->>'cep', d->>'logradouro', d->>'numero', d->>'complemento', d->>'bairro', d->>'cidade', d->>'uf',
      d->>'sus', coalesce(nullif(d->>'convenio', ''), 'Particular'), d->>'sexo', d->>'medico', d->>'grupo', d->>'ocupacao', d->>'cpf')
    RETURNING paciente_id INTO novo;
    RETURN novo;
  END IF;
  UPDATE public.pacientes SET
    name = CASE WHEN d ? 'name' AND btrim(d->>'name') <> '' THEN btrim(d->>'name') ELSE name END,
    data_nascimento = CASE WHEN d ? 'data_nascimento' THEN nullif(d->>'data_nascimento', '')::date ELSE data_nascimento END,
    telefone = CASE WHEN d ? 'telefone' THEN d->>'telefone' ELSE telefone END,
    email = CASE WHEN d ? 'email' THEN d->>'email' ELSE email END,
    mae = CASE WHEN d ? 'mae' THEN d->>'mae' ELSE mae END,
    pai = CASE WHEN d ? 'pai' THEN d->>'pai' ELSE pai END,
    endereco = CASE WHEN d ? 'endereco' THEN d->>'endereco' ELSE endereco END,
    cep = CASE WHEN d ? 'cep' THEN d->>'cep' ELSE cep END,
    logradouro = CASE WHEN d ? 'logradouro' THEN d->>'logradouro' ELSE logradouro END,
    numero = CASE WHEN d ? 'numero' THEN d->>'numero' ELSE numero END,
    complemento = CASE WHEN d ? 'complemento' THEN d->>'complemento' ELSE complemento END,
    bairro = CASE WHEN d ? 'bairro' THEN d->>'bairro' ELSE bairro END,
    cidade = CASE WHEN d ? 'cidade' THEN d->>'cidade' ELSE cidade END,
    uf = CASE WHEN d ? 'uf' THEN d->>'uf' ELSE uf END,
    sus = CASE WHEN d ? 'sus' THEN d->>'sus' ELSE sus END,
    convenio = CASE WHEN d ? 'convenio' THEN d->>'convenio' ELSE convenio END,
    sexo = CASE WHEN d ? 'sexo' THEN d->>'sexo' ELSE sexo END,
    medico = CASE WHEN d ? 'medico' THEN d->>'medico' ELSE medico END,
    grupo = CASE WHEN d ? 'grupo' THEN d->>'grupo' ELSE grupo END,
    ocupacao = CASE WHEN d ? 'ocupacao' THEN d->>'ocupacao' ELSE ocupacao END,
    cpf = CASE WHEN d ? 'cpf' THEN d->>'cpf' ELSE cpf END
  WHERE paciente_id = p_id AND user_id = cid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.paciente_cadastro_salvar(uuid, jsonb) TO authenticated;

/* ---------- acesso da equipe às tabelas do fluxo ---------- */

DROP POLICY IF EXISTS "Equipe gerencia a agenda da clinica" ON public.agendamentos;

CREATE POLICY "Equipe gerencia a agenda da clinica" ON public.agendamentos FOR ALL TO authenticated
  USING ((SELECT public.papel_clinica()) <> 'medico' AND id_medico = (SELECT public.clinica_id()))
  WITH CHECK ((SELECT public.papel_clinica()) <> 'medico' AND id_medico = (SELECT public.clinica_id()));

DROP POLICY IF EXISTS "Equipe le as etapas da clinica" ON public.atendimento_etapas;

CREATE POLICY "Equipe le as etapas da clinica" ON public.atendimento_etapas FOR SELECT TO authenticated
  USING (id_medico = (SELECT public.clinica_id()));

DROP POLICY IF EXISTS "Equipe move os cards da clinica" ON public.atendimento_fluxo;

CREATE POLICY "Equipe move os cards da clinica" ON public.atendimento_fluxo FOR ALL TO authenticated
  USING ((SELECT public.papel_clinica()) <> 'medico' AND id_medico = (SELECT public.clinica_id()))
  WITH CHECK ((SELECT public.papel_clinica()) <> 'medico' AND id_medico = (SELECT public.clinica_id()));

DROP POLICY IF EXISTS "Equipe le eventos do fluxo da clinica" ON public.atendimento_fluxo_eventos;

CREATE POLICY "Equipe le eventos do fluxo da clinica" ON public.atendimento_fluxo_eventos FOR SELECT TO authenticated
  USING (id_medico = (SELECT public.clinica_id()));

DROP POLICY IF EXISTS "Enfermagem registra triagens da clinica" ON public.triagens;

CREATE POLICY "Enfermagem registra triagens da clinica" ON public.triagens FOR ALL TO authenticated
  USING ((SELECT public.papel_clinica()) = 'enfermeiro' AND id_medico = (SELECT public.clinica_id()))
  WITH CHECK ((SELECT public.papel_clinica()) = 'enfermeiro' AND id_medico = (SELECT public.clinica_id()));

-- Secretária: só as receitas de consulta lançadas pelo kanban (entrada/cobrança).
DROP POLICY IF EXISTS "Secretaria cobra consultas da clinica" ON public.lancamentos_financeiros;

CREATE POLICY "Secretaria cobra consultas da clinica" ON public.lancamentos_financeiros FOR ALL TO authenticated
  USING ((SELECT public.papel_clinica()) = 'secretaria' AND user_id = (SELECT public.clinica_id()) AND origem = 'consulta')
  WITH CHECK ((SELECT public.papel_clinica()) = 'secretaria' AND user_id = (SELECT public.clinica_id()) AND origem = 'consulta');

-- Linhas criadas por um membro pertencem à clínica, não ao login dele.
ALTER TABLE public.atendimento_fluxo ALTER COLUMN id_medico SET DEFAULT public.clinica_id();

ALTER TABLE public.atendimento_etapas ALTER COLUMN id_medico SET DEFAULT public.clinica_id();

ALTER TABLE public.triagens ALTER COLUMN id_medico SET DEFAULT public.clinica_id();

ALTER TABLE public.lancamentos_financeiros ALTER COLUMN user_id SET DEFAULT public.clinica_id();

-- Etapas padrão da clínica, também quando quem abre o kanban é um membro.
CREATE OR REPLACE FUNCTION public.atendimento_etapas_garantir()
RETURNS SETOF public.atendimento_etapas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := public.clinica_id();
  e_fim uuid;
  e_con uuid;
  e_esp uuid;
  e_tri uuid;
  e_rec uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('atendimento_etapas:' || uid::text));
  IF NOT EXISTS (SELECT 1 FROM public.atendimento_etapas WHERE id_medico = uid) THEN
    INSERT INTO public.atendimento_etapas (id_medico, nome, cor, ordem, tipo, atalho, acao_ao_entrar, gatilho_cobranca)
      VALUES (uid, 'Atendidos', '#16a34a', 60, 'concluido', 'cobrar', 'finalizar', true) RETURNING id INTO e_fim;
    INSERT INTO public.atendimento_etapas (id_medico, nome, cor, ordem, tipo, atalho, acao_ao_entrar, encaminhar_para, limite_minutos)
      VALUES (uid, 'No consultório', '#4f46e5', 50, 'consultorio', 'finalizar', 'atender', e_fim, 40) RETURNING id INTO e_con;
    INSERT INTO public.atendimento_etapas (id_medico, nome, cor, ordem, tipo, atalho, encaminhar_para, limite_minutos)
      VALUES (uid, 'Aguardando médico', '#0891b2', 40, 'espera', 'atender', e_con, 30) RETURNING id INTO e_esp;
    INSERT INTO public.atendimento_etapas (id_medico, nome, cor, ordem, tipo, atalho, encaminhar_para, limite_minutos)
      VALUES (uid, 'Triagem', '#7c3aed', 30, 'triagem', 'triagem', e_esp, 15) RETURNING id INTO e_tri;
    INSERT INTO public.atendimento_etapas (id_medico, nome, cor, ordem, tipo, atalho, encaminhar_para, limite_minutos)
      VALUES (uid, 'Aguardando recepção', '#d97706', 20, 'espera', 'entrada', e_tri, 15) RETURNING id INTO e_rec;
    INSERT INTO public.atendimento_etapas (id_medico, nome, cor, ordem, tipo, atalho, encaminhar_para, limite_minutos)
      VALUES (uid, 'Agendados', '#2563eb', 10, 'agendado', 'chegada', e_rec, 10);
  END IF;
  RETURN QUERY SELECT * FROM public.atendimento_etapas
    WHERE id_medico = uid AND NOT arquivada ORDER BY ordem, created_at;
END;
$$;
