-- Rascunhos do "Studio de protocolo" (canvas visual, protocolo-studio.html).
--
-- Experimental e paralelo ao fluxo oficial (protocolos / protocolo_acoes /
-- protocolo_regras). Por isso, em vez de modelar nós/arestas/ramos/eventos
-- em tabelas relacionais separadas — o que travaria a modelagem enquanto o
-- canvas ainda está mudando de forma — o grafo inteiro (nodes + edges) fica
-- em um único jsonb. Quando o Studio virar o fluxo oficial, esse jsonb é o
-- que vai ser migrado para protocolo_acoes/protocolo_regras (ou para um
-- schema relacional novo, se o modelo de grafo for adiante como está).

CREATE TABLE public.protocolo_estudio_rascunhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  titulo text NOT NULL DEFAULT 'Rascunho sem título',
  -- { "nodes": [...], "edges": [...] } — mesmo formato usado em memória pelo
  -- ProtocolCanvas (ver buildGraphFromAiSpec em protocolo-studio.html).
  grafo jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.protocolo_estudio_rascunhos TO authenticated;
GRANT ALL ON public.protocolo_estudio_rascunhos TO service_role;

ALTER TABLE public.protocolo_estudio_rascunhos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Medicos gerenciam seus rascunhos do studio" ON public.protocolo_estudio_rascunhos
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reaproveita a função de trigger já usada em protocolos/outras tabelas do
-- projeto, então updated_at é mantido automaticamente igual ao resto do app.
CREATE TRIGGER trg_protocolo_estudio_rascunhos_updated
  BEFORE UPDATE ON public.protocolo_estudio_rascunhos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
