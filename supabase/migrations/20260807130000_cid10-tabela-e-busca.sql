-- =========================================================
-- cid10: tabela de referência de códigos CID-10, nos mesmos
-- moldes de tuss_procedimentos. Usada pelo campo CID da
-- Solicitação de Exames e pelo seletor de CIDs em
-- Informações Complementares (que antes usava uma lista fixa
-- em JavaScript, CID10_DB).
-- =========================================================
CREATE TABLE public.cid10 (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cid10 TO authenticated;
GRANT ALL ON public.cid10 TO service_role;

ALTER TABLE public.cid10 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados podem ler CID10"
  ON public.cid10 FOR SELECT TO authenticated
  USING (true);

CREATE INDEX idx_cid10_codigo ON public.cid10(codigo);

CREATE OR REPLACE FUNCTION public.buscar_cid10(termo text, p_limit integer DEFAULT 20)
RETURNS TABLE(codigo text, descricao text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH t AS (SELECT nullif(trim(coalesce(termo,'')), '') AS q)
  SELECT c.codigo, c.descricao
  FROM public.cid10 c, t
  WHERE t.q IS NULL
     OR c.codigo ILIKE t.q || '%'
     OR lower(public.unaccent(c.descricao)) LIKE '%' || lower(public.unaccent(t.q)) || '%'
  ORDER BY
    (t.q IS NOT NULL AND upper(c.codigo) = upper(t.q)) DESC,
    (t.q IS NOT NULL AND c.codigo ILIKE t.q || '%') DESC,
    c.codigo
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- Conjunto inicial de códigos: os 50 que já estavam em uso em Informações
-- Complementares (CID10_DB) + uma seleção adicional de códigos comuns na
-- prática clínica geral. NÃO é o catálogo oficial completo do CID-10
-- (que tem ~14 mil subcategorias) — é um ponto de partida com os códigos
-- mais usados no dia a dia. Se quiser cobertura completa, dá pra importar
-- a tabela oficial do DATASUS aqui do mesmo jeito que foi feito com o TUSS.
INSERT INTO public.cid10 (codigo, descricao) VALUES
  ('A09', 'Diarreia e gastroenterite de origem infecciosa presumível'),
  ('A90', 'Dengue [dengue clássico]'),
  ('B34.9', 'Infecção viral não especificada'),
  ('B35.0', 'Tinha da barba e do couro cabeludo'),
  ('E03.9', 'Hipotireoidismo não especificado'),
  ('E04.9', 'Bócio não tóxico não especificado'),
  ('E05.9', 'Tireotoxicose não especificada'),
  ('E10', 'Diabetes mellitus tipo 1'),
  ('E11', 'Diabetes mellitus tipo 2'),
  ('E11.9', 'Diabetes mellitus tipo 2 sem complicações'),
  ('E66.0', 'Obesidade devida a excesso de calorias'),
  ('E66.9', 'Obesidade não especificada'),
  ('E78.0', 'Hipercolesterolemia pura'),
  ('E78.5', 'Dislipidemia não especificada'),
  ('E86', 'Depleção de volume (desidratação)'),
  ('F32.9', 'Episódio depressivo não especificado'),
  ('F41.0', 'Transtorno de pânico'),
  ('F41.1', 'Ansiedade generalizada'),
  ('F41.9', 'Transtorno de ansiedade não especificado'),
  ('F51.0', 'Insônia não orgânica'),
  ('G43.9', 'Enxaqueca não especificada'),
  ('G47.9', 'Distúrbio do sono não especificado'),
  ('H10.9', 'Conjuntivite não especificada'),
  ('H60.9', 'Otite externa não especificada'),
  ('H66.9', 'Otite média não especificada'),
  ('I10', 'Hipertensão essencial (primária)'),
  ('I20.9', 'Angina pectoris não especificada'),
  ('I21.9', 'Infarto agudo do miocárdio não especificado'),
  ('I25.1', 'Doença aterosclerótica do coração'),
  ('I48', 'Fibrilação e flutter atrial'),
  ('I50.9', 'Insuficiência cardíaca não especificada'),
  ('I63.9', 'Infarto cerebral não especificado'),
  ('I83.9', 'Varizes dos membros inferiores sem úlcera ou inflamação'),
  ('J01.9', 'Sinusite aguda não especificada'),
  ('J02.9', 'Faringite aguda não especificada'),
  ('J03.9', 'Amigdalite aguda não especificada'),
  ('J06.9', 'Infecção aguda das vias aéreas superiores não especificada'),
  ('J11', 'Influenza (gripe), vírus não identificado'),
  ('J18.9', 'Pneumonia não especificada'),
  ('J20.9', 'Bronquite aguda não especificada'),
  ('J30.4', 'Rinite alérgica não especificada'),
  ('J45', 'Asma'),
  ('J44.9', 'Doença pulmonar obstrutiva crônica não especificada'),
  ('K21.9', 'Doença do refluxo gastroesofágico sem esofagite'),
  ('K29.7', 'Gastrite não especificada'),
  ('K30', 'Dispepsia funcional'),
  ('K35.9', 'Apendicite aguda não especificada'),
  ('K52.9', 'Gastroenterite e colite não infecciosas não especificadas'),
  ('K59.0', 'Constipação'),
  ('K59.1', 'Diarreia funcional'),
  ('K80.2', 'Cálculo da vesícula biliar sem colecistite'),
  ('L03.9', 'Celulite não especificada'),
  ('L20.9', 'Dermatite atópica não especificada'),
  ('L23.9', 'Dermatite alérgica de contato, de causa não especificada'),
  ('L30.9', 'Dermatite não especificada'),
  ('L50.9', 'Urticária não especificada'),
  ('M10.9', 'Gota não especificada'),
  ('M17.9', 'Gonartrose não especificada'),
  ('M19.9', 'Artrose não especificada'),
  ('M25.5', 'Dor articular'),
  ('M54.2', 'Cervicalgia'),
  ('M54.4', 'Lumbago com ciática'),
  ('M54.5', 'Dor lombar baixa'),
  ('M54.9', 'Dorsalgia não especificada'),
  ('M79.1', 'Mialgia'),
  ('M79.7', 'Fibromialgia'),
  ('N30.9', 'Cistite não especificada'),
  ('N39.0', 'Infecção do trato urinário de localização não especificada'),
  ('N18.9', 'Doença renal crônica não especificada'),
  ('N20.0', 'Cálculo do rim'),
  ('N92.6', 'Menstruação irregular não especificada'),
  ('O99.9', 'Estado obstétrico não especificado'),
  ('R05', 'Tosse'),
  ('R06.0', 'Dispneia'),
  ('R07.4', 'Dor no peito não especificada'),
  ('R10.4', 'Outras dores abdominais e as não especificadas'),
  ('R11', 'Náusea e vômitos'),
  ('R42', 'Tontura e instabilidade'),
  ('R50.9', 'Febre não especificada'),
  ('R51', 'Cefaleia'),
  ('R53', 'Mal estar e fadiga'),
  ('R73.9', 'Hiperglicemia não especificada'),
  ('R94.3', 'Resultados anormais de estudos funcionais cardiovasculares'),
  ('T78.4', 'Alergia não especificada'),
  ('Z00.0', 'Exame médico geral'),
  ('Z01.7', 'Exame laboratorial'),
  ('Z01.8', 'Outros exames especiais especificados'),
  ('Z34.9', 'Supervisão de gravidez normal, não especificada'),
  ('Z71.3', 'Aconselhamento dietético'),
  ('Z76.3', 'Pessoa em boa saúde acompanhando doente')
ON CONFLICT (codigo) DO NOTHING;
