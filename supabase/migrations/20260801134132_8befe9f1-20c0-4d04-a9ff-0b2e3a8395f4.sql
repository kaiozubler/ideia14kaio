CREATE POLICY "Owner can read own bry signed docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bry-signed-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );