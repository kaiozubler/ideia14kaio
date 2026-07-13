
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS public.substancias (
  id_substancia uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome_dcb text NOT NULL UNIQUE,
  nome_exibicao text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.substancias TO anon, authenticated;
GRANT ALL ON public.substancias TO service_role;
ALTER TABLE public.substancias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Substancias leitura publica" ON public.substancias FOR SELECT USING (true);

ALTER TABLE public.medicamentos
  ADD COLUMN IF NOT EXISTS is_generico boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cnpj_fabricante text,
  ADD COLUMN IF NOT EXISTS codigo_ggrem text,
  ADD COLUMN IF NOT EXISTS regime_preco text,
  ADD COLUMN IF NOT EXISTS comercializado_2025 boolean,
  ADD COLUMN IF NOT EXISTS registro_anvisa text,
  ADD COLUMN IF NOT EXISTS classe_terapeutica text,
  ADD COLUMN IF NOT EXISTS categoria_regulatoria text,
  ADD COLUMN IF NOT EXISTS tarja text,
  ADD COLUMN IF NOT EXISTS apresentacao text;

CREATE UNIQUE INDEX IF NOT EXISTS medicamentos_registro_anvisa_unique
  ON public.medicamentos (registro_anvisa) WHERE registro_anvisa IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.medicamento_substancias (
  id_medicamento text NOT NULL REFERENCES public.medicamentos(id) ON DELETE CASCADE,
  id_substancia uuid NOT NULL REFERENCES public.substancias(id_substancia) ON DELETE CASCADE,
  concentracao text,
  PRIMARY KEY (id_medicamento, id_substancia)
);
CREATE INDEX IF NOT EXISTS idx_medsub_substancia ON public.medicamento_substancias(id_substancia);
CREATE INDEX IF NOT EXISTS idx_medsub_medicamento ON public.medicamento_substancias(id_medicamento);
GRANT SELECT ON public.medicamento_substancias TO anon, authenticated;
GRANT ALL ON public.medicamento_substancias TO service_role;
ALTER TABLE public.medicamento_substancias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicamento substancias leitura publica"
  ON public.medicamento_substancias FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.interacoes_medicamentosas (
  id_interacao uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  id_substancia_a uuid NOT NULL REFERENCES public.substancias(id_substancia) ON DELETE CASCADE,
  id_substancia_b uuid NOT NULL REFERENCES public.substancias(id_substancia) ON DELETE CASCADE,
  gravidade text,
  descricao text,
  fonte text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interacoes_par_unique UNIQUE (id_substancia_a, id_substancia_b),
  CONSTRAINT interacoes_nao_igual CHECK (id_substancia_a <> id_substancia_b)
);
CREATE INDEX IF NOT EXISTS idx_interacao_a ON public.interacoes_medicamentosas(id_substancia_a);
CREATE INDEX IF NOT EXISTS idx_interacao_b ON public.interacoes_medicamentosas(id_substancia_b);
GRANT SELECT ON public.interacoes_medicamentosas TO anon, authenticated;
GRANT ALL ON public.interacoes_medicamentosas TO service_role;
ALTER TABLE public.interacoes_medicamentosas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Interacoes leitura publica"
  ON public.interacoes_medicamentosas FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.normaliza_substancia(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(regexp_replace(
    upper(public.unaccent(coalesce(t,''))),
    '\s+', ' ', 'g'
  ), '');
$$;

-- Migra compostos[] -> substancias + vínculos
WITH exploded AS (
  SELECT m.id AS id_medicamento,
         public.normaliza_substancia(c) AS nome_dcb
  FROM public.medicamentos m, unnest(m.compostos) AS c
  WHERE c IS NOT NULL AND btrim(c) <> ''
),
uniq AS (
  SELECT DISTINCT nome_dcb FROM exploded WHERE nome_dcb IS NOT NULL
)
INSERT INTO public.substancias (nome_dcb, nome_exibicao)
SELECT nome_dcb, initcap(lower(nome_dcb)) FROM uniq
ON CONFLICT (nome_dcb) DO NOTHING;

INSERT INTO public.medicamento_substancias (id_medicamento, id_substancia)
SELECT DISTINCT m.id, s.id_substancia
FROM public.medicamentos m
CROSS JOIN LATERAL unnest(m.compostos) AS c
JOIN public.substancias s
  ON s.nome_dcb = public.normaliza_substancia(c)
WHERE c IS NOT NULL AND btrim(c) <> ''
ON CONFLICT DO NOTHING;
