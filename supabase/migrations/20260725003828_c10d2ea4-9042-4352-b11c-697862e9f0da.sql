CREATE POLICY "Doctors can read own signed documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'signed-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );