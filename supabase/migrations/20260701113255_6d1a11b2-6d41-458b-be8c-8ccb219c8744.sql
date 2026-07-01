
CREATE TABLE public.medicamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_comercial text NOT NULL,
  composicao text,
  compostos text[] NOT NULL DEFAULT '{}',
  apresentacoes text[] NOT NULL DEFAULT '{}',
  fabricante text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.medicamentos TO anon, authenticated;
GRANT ALL ON public.medicamentos TO service_role;

ALTER TABLE public.medicamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Medicamentos são públicos para leitura" ON public.medicamentos FOR SELECT USING (true);

INSERT INTO public.medicamentos (nome_comercial, composicao, compostos, apresentacoes, fabricante) VALUES
('Tylenol','Paracetamol', ARRAY['Paracetamol'], ARRAY['Comprimido 500mg','Comprimido 750mg','Gotas 200mg/mL 15mL','Xarope 32mg/mL 60mL'], 'Janssen'),
('Dipirona Sódica','Dipirona monoidratada', ARRAY['Dipirona'], ARRAY['Comprimido 500mg','Comprimido 1g','Gotas 500mg/mL 10mL','Solução injetável 500mg/mL 2mL'], 'EMS'),
('Amoxil','Amoxicilina', ARRAY['Amoxicilina'], ARRAY['Cápsula 500mg','Suspensão oral 250mg/5mL 150mL','Suspensão oral 400mg/5mL 100mL'], 'GSK'),
('Losartana Potássica','Losartana potássica', ARRAY['Losartana'], ARRAY['Comprimido 25mg','Comprimido 50mg','Comprimido 100mg'], 'Medley'),
('Puran T4','Levotiroxina sódica', ARRAY['Levotiroxina'], ARRAY['Comprimido 25mcg','Comprimido 50mcg','Comprimido 75mcg','Comprimido 100mcg','Comprimido 150mcg'], 'Sanofi'),
('Selozok','Succinato de metoprolol', ARRAY['Metoprolol'], ARRAY['Comprimido 25mg','Comprimido 50mg','Comprimido 100mg'], 'AstraZeneca'),
('Glifage XR','Cloridrato de metformina', ARRAY['Metformina'], ARRAY['Comprimido 500mg','Comprimido 750mg','Comprimido 1000mg'], 'Merck'),
('Rivotril','Clonazepam', ARRAY['Clonazepam'], ARRAY['Comprimido 0,5mg','Comprimido 2mg','Gotas 2,5mg/mL 20mL'], 'Roche'),
('Omeprazol','Omeprazol', ARRAY['Omeprazol'], ARRAY['Cápsula 10mg','Cápsula 20mg','Cápsula 40mg'], 'EMS'),
('Sinvastatina','Sinvastatina', ARRAY['Sinvastatina'], ARRAY['Comprimido 10mg','Comprimido 20mg','Comprimido 40mg'], 'Medley'),
('Predsim','Prednisolona', ARRAY['Prednisolona'], ARRAY['Solução oral 3mg/mL 60mL','Solução oral 3mg/mL 120mL'], 'Mantecorp'),
('Cataflam','Diclofenaco potássico', ARRAY['Diclofenaco'], ARRAY['Comprimido revestido 50mg','Gotas 15mg/mL 20mL'], 'Novartis'),
('Nimesulida','Nimesulida', ARRAY['Nimesulida'], ARRAY['Comprimido 100mg','Granulado 100mg','Gotas 50mg/mL 15mL'], 'EMS'),
('Cefalexina','Cefalexina monoidratada', ARRAY['Cefalexina'], ARRAY['Cápsula 500mg','Suspensão oral 250mg/5mL 60mL','Suspensão oral 500mg/5mL 100mL'], 'Teuto'),
('Azitromicina','Azitromicina di-hidratada', ARRAY['Azitromicina'], ARRAY['Comprimido 500mg','Suspensão oral 200mg/5mL 15mL','Suspensão oral 600mg 15mL'], 'EMS'),
('Neosaldina','Dipirona + Isometepteno + Cafeína', ARRAY['Dipirona','Isometepteno','Cafeína'], ARRAY['Drágea','Gotas 20mL'], 'Takeda');
