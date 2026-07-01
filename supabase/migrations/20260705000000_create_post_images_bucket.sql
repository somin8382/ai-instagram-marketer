-- Create a public storage bucket for generated post images (durable, non-expiring URLs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-images',
  'post-images',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow server-side anon key to upload images
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'post_images_anon_insert'
  ) THEN
    CREATE POLICY "post_images_anon_insert" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'post-images');
  END IF;
END $$;

-- Allow public (unauthenticated) reads for rendered images and downloads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'post_images_public_read'
  ) THEN
    CREATE POLICY "post_images_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'post-images');
  END IF;
END $$;
