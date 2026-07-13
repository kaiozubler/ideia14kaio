
-- 1) Substâncias
WITH split AS (
  SELECT DISTINCT public.normaliza_substancia(trim(s)) AS nome_dcb
  FROM public.anvisa_import,
       LATERAL regexp_split_to_table(coalesce(substancia,''), ';') AS s
)
INSERT INTO public.substancias (nome_dcb, nome_exibicao)
SELECT nome_dcb, initcap(lower(nome_dcb))
FROM split
WHERE nome_dcb IS NOT NULL
ON CONFLICT (nome_dcb) DO NOTHING;

-- 2) Medicamentos (dedup por registro; usa id = registro)
INSERT INTO public.medicamentos (
  id, nome_comercial, fabricante, apresentacoes, compostos,
  registro_anvisa, cnpj_fabricante, codigo_ggrem, regime_preco,
  comercializado_2025, classe_terapeutica, categoria_regulatoria,
  tarja, apresentacao, is_generico
)
SELECT DISTINCT ON (registro)
  registro,
  coalesce(nullif(produto,''), 'SEM NOME'),
  nullif(laboratorio,''),
  CASE WHEN nullif(apresentacao,'') IS NULL THEN '{}'::text[] ELSE ARRAY[apresentacao] END,
  '{}'::text[],
  registro,
  nullif(cnpj,''),
  nullif(codigo_ggrem,''),
  nullif(regime_preco,''),
  CASE WHEN upper(coalesce(comerc_2025,'')) IN ('SIM','TRUE','1') THEN true
       WHEN upper(coalesce(comerc_2025,'')) IN ('NAO','NÃO','FALSE','0') THEN false
       ELSE NULL END,
  nullif(classe_terapeutica,''),
  nullif(tipo_produto,''),
  nullif(tarja,''),
  nullif(apresentacao,''),
  (public.normaliza_substancia(coalesce(tipo_produto,'')) LIKE '%GENERIC%')
FROM public.anvisa_import
WHERE registro IS NOT NULL AND btrim(registro) <> ''
ON CONFLICT (id) DO UPDATE SET
  nome_comercial = EXCLUDED.nome_comercial,
  fabricante = EXCLUDED.fabricante,
  apresentacoes = EXCLUDED.apresentacoes,
  registro_anvisa = EXCLUDED.registro_anvisa,
  cnpj_fabricante = EXCLUDED.cnpj_fabricante,
  codigo_ggrem = EXCLUDED.codigo_ggrem,
  regime_preco = EXCLUDED.regime_preco,
  comercializado_2025 = EXCLUDED.comercializado_2025,
  classe_terapeutica = EXCLUDED.classe_terapeutica,
  categoria_regulatoria = EXCLUDED.categoria_regulatoria,
  tarja = EXCLUDED.tarja,
  apresentacao = EXCLUDED.apresentacao,
  is_generico = EXCLUDED.is_generico;

-- 3) Vínculos
WITH split AS (
  SELECT ai.registro,
         public.normaliza_substancia(trim(s)) AS nome_dcb
  FROM public.anvisa_import ai,
       LATERAL regexp_split_to_table(coalesce(ai.substancia,''), ';') AS s
  WHERE ai.registro IS NOT NULL AND btrim(ai.registro) <> ''
)
INSERT INTO public.medicamento_substancias (id_medicamento, id_substancia)
SELECT DISTINCT m.id, s.id_substancia
FROM split sp
JOIN public.medicamentos m ON m.registro_anvisa = sp.registro
JOIN public.substancias s ON s.nome_dcb = sp.nome_dcb
WHERE sp.nome_dcb IS NOT NULL
ON CONFLICT DO NOTHING;

DROP TABLE public.anvisa_import;
