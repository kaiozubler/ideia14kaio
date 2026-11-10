-- A senha do link curto /v/<codigo> passou a ser os 4 PRIMEIROS digitos do CPF
-- (hash = sha256("<id>:inicio:<4 primeiros>")). Os documentos reservados antes
-- guardaram sha256("<id>:<4 ultimos>") e nao trazem o CPF; aqui o CPF vem do
-- cadastro do paciente da mesma clinica com o mesmo nome, e so e usado quando
-- reproduz exatamente o hash antigo (prova de que e o paciente do documento).
-- Documentos sem paciente correspondente (ex.: documento avulso com CPF
-- digitado) seguem abrindo com os 4 ultimos digitos (fallback em conferirSenha).

WITH candidatos AS (
  SELECT
    d.id,
    left(regexp_replace(p.cpf, '\D', '', 'g'), 4) AS primeiros4
  FROM public.documentos_verificacao d
  JOIN public.pacientes p
    ON lower(btrim(p.name)) = lower(btrim(d.paciente_nome))
   AND (
     p.user_id = d.id_medico
     OR p.user_id IN (SELECT m.clinica_id FROM public.clinica_membros m WHERE m.user_id = d.id_medico)
   )
  WHERE length(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g')) = 11
    AND d.senha_hash = encode(
      sha256(convert_to(d.id::text || ':' || right(regexp_replace(p.cpf, '\D', '', 'g'), 4), 'UTF8')),
      'hex'
    )
),
unicos AS (
  -- Dois homonimos com os mesmos 4 ultimos digitos e inicio diferente: ambiguo, nao migra.
  SELECT id, min(primeiros4) AS primeiros4
  FROM candidatos
  GROUP BY id
  HAVING count(DISTINCT primeiros4) = 1
)
UPDATE public.documentos_verificacao d
SET senha_hash = encode(sha256(convert_to(d.id::text || ':inicio:' || u.primeiros4, 'UTF8')), 'hex')
FROM unicos u
WHERE d.id = u.id;
