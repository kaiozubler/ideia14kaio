
CREATE TABLE IF NOT EXISTS public.anvisa_import (
  substancia text,
  cnpj text,
  laboratorio text,
  codigo_ggrem text,
  registro text,
  produto text,
  apresentacao text,
  classe_terapeutica text,
  tipo_produto text,
  regime_preco text,
  comerc_2025 text,
  tarja text
);
GRANT ALL ON public.anvisa_import TO service_role;
ALTER TABLE public.anvisa_import ENABLE ROW LEVEL SECURITY;
