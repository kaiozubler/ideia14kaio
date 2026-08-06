CREATE TABLE public.tuss_procedimentos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo_tuss text NOT NULL,
  nome text NOT NULL,
  descricao text,
  classe text,
  grupo text,
  subgrupo text,
  tabela text NOT NULL DEFAULT 'tuss-22',
  status text,
  inicio_vigencia date,
  fim_vigencia date,
  fim_implantacao date,
  dados_originais jsonb NOT NULL DEFAULT '{}'::jsonb,
  ultima_sincronizacao timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tuss_procedimentos_codigo_tuss_key ON public.tuss_procedimentos (codigo_tuss);
CREATE INDEX tuss_procedimentos_nome_trgm ON public.tuss_procedimentos USING gin (public.normaliza_substancia(nome) gin_trgm_ops);
CREATE INDEX tuss_procedimentos_nome_idx ON public.tuss_procedimentos (nome);
CREATE INDEX tuss_procedimentos_fts ON public.tuss_procedimentos USING gin (to_tsvector('portuguese', coalesce(nome,'') || ' ' || coalesce(descricao,'')));
CREATE INDEX tuss_procedimentos_grupo_idx ON public.tuss_procedimentos (grupo);
CREATE INDEX tuss_procedimentos_tabela_idx ON public.tuss_procedimentos (tabela);

GRANT SELECT ON public.tuss_procedimentos TO authenticated;
GRANT ALL ON public.tuss_procedimentos TO service_role;

ALTER TABLE public.tuss_procedimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tuss_leitura_autenticada" ON public.tuss_procedimentos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tuss_sem_escrita_insert" ON public.tuss_procedimentos AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "tuss_sem_escrita_update" ON public.tuss_procedimentos AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY "tuss_sem_escrita_delete" ON public.tuss_procedimentos AS RESTRICTIVE
  FOR DELETE TO authenticated USING (false);

CREATE TRIGGER trg_tuss_procedimentos_updated
  BEFORE UPDATE ON public.tuss_procedimentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.tuss_sync_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tabela text NOT NULL DEFAULT 'tuss-22',
  status text NOT NULL DEFAULT 'em_andamento',
  paginas_total integer NOT NULL DEFAULT 0,
  paginas_processadas integer NOT NULL DEFAULT 0,
  quantidade_processada integer NOT NULL DEFAULT 0,
  quantidade_novas integer NOT NULL DEFAULT 0,
  quantidade_atualizadas integer NOT NULL DEFAULT 0,
  quantidade_erros integer NOT NULL DEFAULT 0,
  mensagem_erro text,
  data_inicio timestamp with time zone NOT NULL DEFAULT now(),
  data_fim timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tuss_sync_log TO authenticated;
GRANT ALL ON public.tuss_sync_log TO service_role;

ALTER TABLE public.tuss_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tuss_log_leitura_autenticada" ON public.tuss_sync_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tuss_log_sem_escrita_insert" ON public.tuss_sync_log AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "tuss_log_sem_escrita_update" ON public.tuss_sync_log AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY "tuss_log_sem_escrita_delete" ON public.tuss_sync_log AS RESTRICTIVE
  FOR DELETE TO authenticated USING (false);

CREATE TRIGGER trg_tuss_sync_log_updated
  BEFORE UPDATE ON public.tuss_sync_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.buscar_tuss(termo text, p_tabela text DEFAULT 'tuss-22', p_limit integer DEFAULT 30)
RETURNS TABLE(id uuid, codigo_tuss text, nome text, descricao text, grupo text, subgrupo text, classe text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH t AS (SELECT nullif(trim(coalesce(termo,'')), '') AS q)
  SELECT p.id, p.codigo_tuss, p.nome, p.descricao, p.grupo, p.subgrupo, p.classe
  FROM public.tuss_procedimentos p, t
  WHERE p.tabela = coalesce(p_tabela, p.tabela)
    AND (
      t.q IS NULL
      OR p.codigo_tuss LIKE t.q || '%'
      OR lower(public.unaccent(p.nome)) LIKE '%' || lower(public.unaccent(t.q)) || '%'
      OR lower(public.unaccent(coalesce(p.descricao,''))) LIKE '%' || lower(public.unaccent(t.q)) || '%'
    )
  ORDER BY
    (t.q IS NOT NULL AND p.codigo_tuss = t.q) DESC,
    similarity(lower(public.unaccent(p.nome)), lower(public.unaccent(coalesce(t.q,'')))) DESC,
    p.nome
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.buscar_tuss(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_tuss(text, text, integer) TO authenticated, service_role;