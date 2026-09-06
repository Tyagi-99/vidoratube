-- Mode 2: creation_mode on projects + owned rights status on PR2 tables

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS creation_mode text NOT NULL DEFAULT 'script';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_creation_mode_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_creation_mode_check
  CHECK (creation_mode IN ('script', 'voiceover', 'auto_edit'));

CREATE INDEX IF NOT EXISTS projects_user_creation_mode_idx
  ON public.projects(user_id, creation_mode);

-- Add "owned" as an approved rights basis for Mode 2 user uploads.
-- Drop and recreate checks only when the PR2 tables exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_items' AND column_name = 'rights_status'
  ) THEN
    ALTER TABLE public.content_items DROP CONSTRAINT IF EXISTS content_items_rights_status_check;
    ALTER TABLE public.content_items ADD CONSTRAINT content_items_rights_status_check
      CHECK (rights_status IN (
        'unknown','permission_required','permission_requested','permission_granted',
        'permission_denied','licensed','owned','public_domain','do_not_use'
      ));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'creator_accounts' AND column_name = 'permission_status'
  ) THEN
    ALTER TABLE public.creator_accounts DROP CONSTRAINT IF EXISTS creator_accounts_permission_status_check;
    ALTER TABLE public.creator_accounts ADD CONSTRAINT creator_accounts_permission_status_check
      CHECK (permission_status IN (
        'unknown','permission_required','permission_requested','permission_granted',
        'permission_denied','licensed','owned','public_domain','do_not_use'
      ));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rights_decisions' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.rights_decisions DROP CONSTRAINT IF EXISTS rights_decisions_status_check;
    ALTER TABLE public.rights_decisions ADD CONSTRAINT rights_decisions_status_check
      CHECK (status IN (
        'unknown','permission_required','permission_requested','permission_granted',
        'permission_denied','licensed','owned','public_domain','do_not_use'
      ));
  END IF;
END $$;
