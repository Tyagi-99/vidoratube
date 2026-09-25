-- Ensure the generated-videos bucket exists and is private.
-- No bucket DDL shipped with the repo (the bucket was created via dashboard/CLI),
-- so its public/private flag was unverifiable from code. Storage RLS policies
-- scope objects to the owning user's folder; a public bucket would bypass those
-- policies entirely by making every object world-readable.
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-videos', 'generated-videos', false)
ON CONFLICT (id) DO UPDATE SET public = false;
