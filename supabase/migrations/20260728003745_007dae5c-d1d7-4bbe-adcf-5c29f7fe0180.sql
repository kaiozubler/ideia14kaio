CREATE POLICY "Medicos leem seus certificados"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'doctor-certificates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Medicos enviam seus certificados"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'doctor-certificates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Medicos atualizam seus certificados"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'doctor-certificates' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Medicos excluem seus certificados"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'doctor-certificates' AND (storage.foldername(name))[1] = auth.uid()::text);