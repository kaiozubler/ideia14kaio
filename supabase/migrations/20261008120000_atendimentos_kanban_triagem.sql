-- Kanban de Atendimentos (tela inicial) persistido no banco + triagem de enfermagem.
-- Front: public/atendimentos-kanban.js. Decisões em AGENTS.md.
--
--  atendimento_etapas        colunas configuráveis por clínica (tipo dá a semântica:
--                            agendado = entrada das consultas da agenda, concluido = destino
--                            do "Finalizar atendimento"; as demais medem tempo de espera)
--  atendimento_fluxo         um card por consulta do dia (agendamento_id) ou encaixe
--  atendimento_fluxo_eventos entrada/saída de cada etapa, gravado por trigger
--  triagens                  sinais vitais + classificação de risco (Manchester)

CREATE TABLE IF NOT EXISTS public.atendimento_etapas (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 40),
  cor text not null default '#64748b' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  ordem integer not null default 0,
  tipo text not null default 'personalizada'
    check (tipo in ('agendado', 'espera', 'triagem', 'consultorio', 'concluido', 'personalizada')),
  atalho text not null default ''
    check (atalho in ('', 'chegada', 'entrada', 'triagem', 'atender', 'finalizar', 'cobrar', 'confirmar', 'reagendar', 'prontuario')),
  acao_ao_entrar text not null default ''
    check (acao_ao_entrar in ('', 'chegada', 'entrada', 'triagem', 'atender', 'finalizar', 'cobrar', 'confirmar')),
  encaminhar_para uuid references public.atendimento_etapas(id) on delete set null,
  gatilho_notificar boolean not null default false,
  gatilho_confirmar boolean not null default false,
  gatilho_cobranca boolean not null default false,
  -- tempo-alvo na etapa (min); na etapa "agendado" é a tolerância de atraso
  limite_minutos integer check (limite_minutos between 1 and 1440),
  -- vazio = pode mover para qualquer etapa
  destinos_permitidos uuid[] not null default '{}',
  arquivada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS atendimento_etapas_medico_idx ON public.atendimento_etapas (id_medico, ordem);

CREATE UNIQUE INDEX IF NOT EXISTS atendimento_etapas_agendado_uidx ON public.atendimento_etapas (id_medico) WHERE tipo = 'agendado' AND NOT arquivada;

CREATE UNIQUE INDEX IF NOT EXISTS atendimento_etapas_concluido_uidx ON public.atendimento_etapas (id_medico) WHERE tipo = 'concluido' AND NOT arquivada;

DROP TRIGGER IF EXISTS trg_atendimento_etapas_updated ON public.atendimento_etapas;

CREATE TRIGGER trg_atendimento_etapas_updated BEFORE UPDATE ON public.atendimento_etapas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atendimento_etapas TO authenticated;

GRANT ALL ON public.atendimento_etapas TO service_role;

ALTER TABLE public.atendimento_etapas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico gerencia suas etapas de atendimento" ON public.atendimento_etapas;

CREATE POLICY "Medico gerencia suas etapas de atendimento" ON public.atendimento_etapas FOR ALL TO authenticated USING (auth.uid() = id_medico) WITH CHECK (auth.uid() = id_medico);

CREATE TABLE IF NOT EXISTS public.atendimento_fluxo (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null default auth.uid() references auth.users(id) on delete cascade,
  agendamento_id uuid references public.agendamentos(id) on delete cascade,
  paciente_id uuid references public.pacientes(paciente_id) on delete set null,
  paciente_nome text,
  etapa_id uuid not null references public.atendimento_etapas(id),
  etapa_desde timestamptz not null default now(),
  -- horário da consulta; num encaixe, o horário da chegada
  agendado_para timestamptz not null default now(),
  chegada_em timestamptz,
  entrada_em timestamptz,
  triagem_em timestamptz,
  chamado_em timestamptz,
  finalizado_em timestamptz,
  faltou_em timestamptz,
  medico text,
  especialidade text,
  motivo text,
  convenio text,
  modalidade text,
  risco text check (risco in ('vermelho', 'laranja', 'amarelo', 'verde', 'azul')),
  lancamento_id uuid references public.lancamentos_financeiros(id) on delete set null,
  consulta_id uuid references public.consulta(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS atendimento_fluxo_agendamento_uidx ON public.atendimento_fluxo (agendamento_id) WHERE agendamento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS atendimento_fluxo_medico_data_idx ON public.atendimento_fluxo (id_medico, agendado_para);

CREATE INDEX IF NOT EXISTS atendimento_fluxo_etapa_idx ON public.atendimento_fluxo (etapa_id);

DROP TRIGGER IF EXISTS trg_atendimento_fluxo_updated ON public.atendimento_fluxo;

CREATE TRIGGER trg_atendimento_fluxo_updated BEFORE UPDATE ON public.atendimento_fluxo FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atendimento_fluxo TO authenticated;

GRANT ALL ON public.atendimento_fluxo TO service_role;

ALTER TABLE public.atendimento_fluxo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico gerencia seu fluxo de atendimento" ON public.atendimento_fluxo;

CREATE POLICY "Medico gerencia seu fluxo de atendimento" ON public.atendimento_fluxo FOR ALL TO authenticated USING (auth.uid() = id_medico) WITH CHECK (auth.uid() = id_medico);

CREATE TABLE IF NOT EXISTS public.atendimento_fluxo_eventos (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null references auth.users(id) on delete cascade,
  fluxo_id uuid not null references public.atendimento_fluxo(id) on delete cascade,
  etapa_id uuid references public.atendimento_etapas(id) on delete set null,
  etapa_nome text not null,
  etapa_tipo text not null,
  entrou_em timestamptz not null default now(),
  saiu_em timestamptz
);

CREATE INDEX IF NOT EXISTS atendimento_fluxo_eventos_fluxo_idx ON public.atendimento_fluxo_eventos (fluxo_id, entrou_em);

GRANT SELECT ON public.atendimento_fluxo_eventos TO authenticated;

GRANT ALL ON public.atendimento_fluxo_eventos TO service_role;

ALTER TABLE public.atendimento_fluxo_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico le eventos do seu fluxo" ON public.atendimento_fluxo_eventos;

CREATE POLICY "Medico le eventos do seu fluxo" ON public.atendimento_fluxo_eventos FOR SELECT TO authenticated USING (auth.uid() = id_medico);

-- etapa_desde vem do relógio do banco: os timers da recepção e do consultório
-- precisam concordar mesmo com computadores de horário desacertado.
CREATE OR REPLACE FUNCTION public.atendimento_fluxo_marcar_etapa()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.etapa_id IS DISTINCT FROM OLD.etapa_id THEN
    NEW.etapa_desde := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atendimento_fluxo_marcar_etapa ON public.atendimento_fluxo;

CREATE TRIGGER trg_atendimento_fluxo_marcar_etapa BEFORE INSERT OR UPDATE OF etapa_id ON public.atendimento_fluxo FOR EACH ROW EXECUTE FUNCTION public.atendimento_fluxo_marcar_etapa();

-- Histórico de etapas gravado no banco (não no cliente) para que o tempo de
-- permanência valha mesmo quando o card é movido por outra aba/computador.
CREATE OR REPLACE FUNCTION public.atendimento_fluxo_registrar_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.etapa_id IS NOT DISTINCT FROM OLD.etapa_id THEN
    RETURN NEW;
  END IF;
  SELECT nome, tipo INTO e FROM public.atendimento_etapas WHERE id = NEW.etapa_id;
  UPDATE public.atendimento_fluxo_eventos SET saiu_em = NEW.etapa_desde
    WHERE fluxo_id = NEW.id AND saiu_em IS NULL;
  INSERT INTO public.atendimento_fluxo_eventos (id_medico, fluxo_id, etapa_id, etapa_nome, etapa_tipo, entrou_em)
    VALUES (NEW.id_medico, NEW.id, NEW.etapa_id, coalesce(e.nome, 'Etapa'), coalesce(e.tipo, 'personalizada'), NEW.etapa_desde);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atendimento_fluxo_evento ON public.atendimento_fluxo;

CREATE TRIGGER trg_atendimento_fluxo_evento AFTER INSERT OR UPDATE OF etapa_id ON public.atendimento_fluxo FOR EACH ROW EXECUTE FUNCTION public.atendimento_fluxo_registrar_evento();

CREATE TABLE IF NOT EXISTS public.triagens (
  id uuid primary key default gen_random_uuid(),
  id_medico uuid not null default auth.uid() references auth.users(id) on delete cascade,
  paciente_id uuid not null references public.pacientes(paciente_id) on delete cascade,
  fluxo_id uuid references public.atendimento_fluxo(id) on delete set null,
  agendamento_id uuid references public.agendamentos(id) on delete set null,
  pa_sistolica integer check (pa_sistolica between 30 and 300),
  pa_diastolica integer check (pa_diastolica between 10 and 200),
  fc integer check (fc between 10 and 300),
  fr integer check (fr between 2 and 80),
  temperatura numeric(4,1) check (temperatura between 25 and 45),
  spo2 integer check (spo2 between 30 and 100),
  glicemia integer check (glicemia between 10 and 1500),
  peso numeric(5,2) check (peso between 0.3 and 400),
  altura numeric(5,1) check (altura between 20 and 250),
  dor integer check (dor between 0 and 10),
  queixa_principal text,
  alergias text,
  medicamentos text,
  observacoes text,
  risco text check (risco in ('vermelho', 'laranja', 'amarelo', 'verde', 'azul')),
  profissional_nome text not null check (length(btrim(profissional_nome)) > 0),
  profissional_registro text,
  realizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS triagens_paciente_idx ON public.triagens (paciente_id, realizado_em desc);

CREATE INDEX IF NOT EXISTS triagens_fluxo_idx ON public.triagens (fluxo_id);

DROP TRIGGER IF EXISTS trg_triagens_updated ON public.triagens;

CREATE TRIGGER trg_triagens_updated BEFORE UPDATE ON public.triagens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.triagens TO authenticated;

GRANT ALL ON public.triagens TO service_role;

ALTER TABLE public.triagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Medico gerencia triagens dos seus pacientes" ON public.triagens;

CREATE POLICY "Medico gerencia triagens dos seus pacientes" ON public.triagens FOR ALL TO authenticated USING (auth.uid() = id_medico) WITH CHECK (auth.uid() = id_medico);

-- Cria as etapas padrão na primeira abertura do kanban. O lock evita que duas
-- abas abertas ao mesmo tempo semeiem o quadro em dobro.
CREATE OR REPLACE FUNCTION public.atendimento_etapas_garantir()
RETURNS SETOF public.atendimento_etapas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  e_fim uuid;
  e_con uuid;
  e_esp uuid;
  e_tri uuid;
  e_rec uuid;
BEGIN
  IF uid IS NULL THEN
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

GRANT EXECUTE ON FUNCTION public.atendimento_etapas_garantir() TO authenticated;

-- Recepção, enfermagem e consultório usam a mesma conta em computadores
-- diferentes: o quadro se atualiza em tempo real entre eles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'atendimento_fluxo') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.atendimento_fluxo;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agendamentos') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.agendamentos;
    END IF;
  END IF;
END;
$$;
