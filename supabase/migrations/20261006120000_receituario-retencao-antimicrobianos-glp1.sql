-- Migration: sinaliza substâncias cuja receita é RETIDA pela farmácia fora da
-- Portaria SVS/MS 344/98, e expõe uma função para classificar texto livre.
--
-- 1) retencao_receita = 'ANTIMICROBIANO' — RDC Anvisa nº 471/2021: receita em
--    2 vias (a 2ª via fica retida), validade de 10 dias, com nome, idade e
--    sexo do paciente.
-- 2) retencao_receita = 'GLP1' — agonistas do receptor de GLP-1 (RDC Anvisa
--    nº 973/2025, que os incluiu no mesmo regime de retenção): receita em
--    2 vias com retenção, validade de 90 dias.
--
-- A lista de antimicrobianos abaixo cobre as substâncias de uso sistêmico
-- comercializadas no Brasil; a referência oficial é o anexo da norma
-- vigente (IN Anvisa nº 360/2025). Ao incluir novas substâncias, use o nome
-- DCB sem acento, em maiúsculas. O matching é por PALAVRA INTEIRA, igual ao
-- usado para a Portaria 344 (20260801190000).

ALTER TABLE public.substancias
  ADD COLUMN IF NOT EXISTS retencao_receita text;

COMMENT ON COLUMN public.substancias.retencao_receita IS
  'Retenção de receita fora da Portaria 344: ANTIMICROBIANO (RDC 471/2021, 2 vias, 10 dias) ou GLP1 (RDC 973/2025, 2 vias, 90 dias)';

WITH v(nome, retencao) AS (VALUES
  -- Antimicrobianos
  ('ACIDO CLAVULANICO', 'ANTIMICROBIANO'), ('ACIDO NALIDIXICO', 'ANTIMICROBIANO'),
  ('ACIDO PIPEMIDICO', 'ANTIMICROBIANO'), ('AMICACINA', 'ANTIMICROBIANO'),
  ('AMOXICILINA', 'ANTIMICROBIANO'), ('AMPICILINA', 'ANTIMICROBIANO'),
  ('AXETILCEFUROXIMA', 'ANTIMICROBIANO'), ('AZITROMICINA', 'ANTIMICROBIANO'),
  ('AZTREONAM', 'ANTIMICROBIANO'), ('BACAMPICILINA', 'ANTIMICROBIANO'),
  ('BENZILPENICILINA', 'ANTIMICROBIANO'), ('CEFACLOR', 'ANTIMICROBIANO'),
  ('CEFADROXILA', 'ANTIMICROBIANO'), ('CEFALEXINA', 'ANTIMICROBIANO'),
  ('CEFALOTINA', 'ANTIMICROBIANO'), ('CEFAZOLINA', 'ANTIMICROBIANO'),
  ('CEFEPIMA', 'ANTIMICROBIANO'), ('CEFOTAXIMA', 'ANTIMICROBIANO'),
  ('CEFOXITINA', 'ANTIMICROBIANO'), ('CEFPODOXIMA', 'ANTIMICROBIANO'),
  ('CEFPROZILA', 'ANTIMICROBIANO'), ('CEFTAROLINA', 'ANTIMICROBIANO'),
  ('CEFTAZIDIMA', 'ANTIMICROBIANO'), ('CEFTRIAXONA', 'ANTIMICROBIANO'),
  ('CEFUROXIMA', 'ANTIMICROBIANO'), ('CIPROFLOXACINO', 'ANTIMICROBIANO'),
  ('CLARITROMICINA', 'ANTIMICROBIANO'), ('CLINDAMICINA', 'ANTIMICROBIANO'),
  ('CLORANFENICOL', 'ANTIMICROBIANO'), ('DAPTOMICINA', 'ANTIMICROBIANO'),
  ('DICLOXACILINA', 'ANTIMICROBIANO'), ('DOXICICLINA', 'ANTIMICROBIANO'),
  ('ERITROMICINA', 'ANTIMICROBIANO'), ('ERTAPENEM', 'ANTIMICROBIANO'),
  ('ESPIRAMICINA', 'ANTIMICROBIANO'), ('ESTREPTOMICINA', 'ANTIMICROBIANO'),
  ('FOSFOMICINA', 'ANTIMICROBIANO'), ('GEMIFLOXACINO', 'ANTIMICROBIANO'),
  ('GENTAMICINA', 'ANTIMICROBIANO'), ('IMIPENEM', 'ANTIMICROBIANO'),
  ('LEVOFLOXACINO', 'ANTIMICROBIANO'), ('LIMECICLINA', 'ANTIMICROBIANO'),
  ('LINEZOLIDA', 'ANTIMICROBIANO'), ('LOMEFLOXACINO', 'ANTIMICROBIANO'),
  ('MEROPENEM', 'ANTIMICROBIANO'), ('METENAMINA', 'ANTIMICROBIANO'),
  ('METRONIDAZOL', 'ANTIMICROBIANO'), ('MINOCICLINA', 'ANTIMICROBIANO'),
  ('MOXIFLOXACINO', 'ANTIMICROBIANO'), ('NEOMICINA', 'ANTIMICROBIANO'),
  ('NITROFURANTOINA', 'ANTIMICROBIANO'), ('NORFLOXACINO', 'ANTIMICROBIANO'),
  ('OFLOXACINO', 'ANTIMICROBIANO'), ('OXACILINA', 'ANTIMICROBIANO'),
  ('OXITETRACICLINA', 'ANTIMICROBIANO'), ('PIPERACILINA', 'ANTIMICROBIANO'),
  ('POLIMIXINA B', 'ANTIMICROBIANO'), ('RIFAMPICINA', 'ANTIMICROBIANO'),
  ('RIFAMICINA', 'ANTIMICROBIANO'), ('ROXITROMICINA', 'ANTIMICROBIANO'),
  ('SECNIDAZOL', 'ANTIMICROBIANO'), ('SULBACTAM', 'ANTIMICROBIANO'),
  ('SULFADIAZINA', 'ANTIMICROBIANO'), ('SULFAMETOXAZOL', 'ANTIMICROBIANO'),
  ('TAZOBACTAM', 'ANTIMICROBIANO'), ('TEICOPLANINA', 'ANTIMICROBIANO'),
  ('TETRACICLINA', 'ANTIMICROBIANO'), ('TIANFENICOL', 'ANTIMICROBIANO'),
  ('TIGECICLINA', 'ANTIMICROBIANO'), ('TINIDAZOL', 'ANTIMICROBIANO'),
  ('TOBRAMICINA', 'ANTIMICROBIANO'), ('TRIMETOPRIMA', 'ANTIMICROBIANO'),
  ('VANCOMICINA', 'ANTIMICROBIANO'),
  -- Agonistas do receptor de GLP-1
  ('SEMAGLUTIDA', 'GLP1'), ('LIRAGLUTIDA', 'GLP1'), ('DULAGLUTIDA', 'GLP1'),
  ('EXENATIDA', 'GLP1'), ('LIXISENATIDA', 'GLP1'), ('TIRZEPATIDA', 'GLP1')
),
candidatos AS (
  SELECT DISTINCT ON (s.id_substancia) s.id_substancia, v.retencao
  FROM public.substancias s
  JOIN v ON (
       public.normaliza_substancia(s.grupo_busca)   ~ ('(^|[^A-Z0-9])' || v.nome || '($|[^A-Z0-9])')
    OR public.normaliza_substancia(s.nome_dcb)      ~ ('(^|[^A-Z0-9])' || v.nome || '($|[^A-Z0-9])')
    OR public.normaliza_substancia(s.nome_exibicao) ~ ('(^|[^A-Z0-9])' || v.nome || '($|[^A-Z0-9])')
  )
  -- GLP-1 prevalece (validade e regra próprias) se algum nome casar com os dois grupos
  ORDER BY s.id_substancia, (v.retencao = 'GLP1') DESC
)
UPDATE public.substancias s
SET retencao_receita = c.retencao
FROM candidatos c
WHERE c.id_substancia = s.id_substancia;

-- Classifica um texto livre (ex.: "Tramadol 50 mg", vindo da Conduta, sem
-- id de substância) devolvendo as substâncias controladas/retidas cujo nome
-- aparece como palavra inteira no texto. Só retorna substâncias que exigem
-- algum receituário especial — as demais não interessam ao chamador.
CREATE OR REPLACE FUNCTION public.classificar_receita_por_texto(p_texto text)
RETURNS TABLE (
  id_substancia uuid,
  nome_dcb text,
  grupo_busca text,
  nome_exibicao text,
  lista_portaria344 text,
  tipo_receita text,
  retencao_receita text
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.normaliza_substancia(p_texto) AS txt),
  -- nomes escapados para uso seguro dentro da regex
  c AS (
    SELECT s.*,
           regexp_replace(public.normaliza_substancia(s.grupo_busca), '([][.^$*+?(){}|\\])', '\\\1', 'g') AS re_grupo,
           regexp_replace(public.normaliza_substancia(s.nome_dcb),    '([][.^$*+?(){}|\\])', '\\\1', 'g') AS re_dcb
    FROM public.substancias s
    WHERE s.lista_portaria344 IS NOT NULL OR s.retencao_receita IS NOT NULL
  )
  SELECT c.id_substancia, c.nome_dcb, c.grupo_busca, c.nome_exibicao,
         c.lista_portaria344, c.tipo_receita, c.retencao_receita
  FROM c, t
  WHERE t.txt IS NOT NULL
    AND (
         (c.re_grupo IS NOT NULL AND t.txt ~ ('(^|[^A-Z0-9])' || c.re_grupo || '($|[^A-Z0-9])'))
      OR (c.re_dcb   IS NOT NULL AND t.txt ~ ('(^|[^A-Z0-9])' || c.re_dcb   || '($|[^A-Z0-9])'))
    );
$$;

GRANT EXECUTE ON FUNCTION public.classificar_receita_por_texto(text) TO authenticated;
