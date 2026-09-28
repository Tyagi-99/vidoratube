-- Phase 5 Stream A (F10) — Vidora Agent conversations + messages.
--
-- agent_conversations: one row per user chat thread with the Vidora Agent.
-- agent_messages: role ∈ user|assistant|tool; every assistant message is
-- persisted with provenance 'ai_analysis'; tool-result summaries derived
-- from real rows carry provenance 'real'.
--
-- Forward-only, non-destructive, IF NOT EXISTS throughout. DO NOT APPLY
-- LIVE from here — apply via the Lovable dashboard SQL editor (Cloud >
-- Database), in filename order, then verify via information_schema.
-- (Per AGENTS.md: Lovable does not auto-apply supabase/migrations/*.sql.)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_id uuid NULL REFERENCES public.workspaces (id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance text NOT NULL DEFAULT 'ai_analysis'
    CHECK (provenance IN ('real', 'estimate', 'ai_analysis', 'fixture')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS agent_conversations_user_workspace_idx
  ON public.agent_conversations (user_id, workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_messages_conversation_idx
  ON public.agent_messages (conversation_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- updated_at trigger (reuses the existing public.touch_updated_at())
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'agent_conversations_touch_updated_at'
  ) THEN
    CREATE TRIGGER agent_conversations_touch_updated_at
      BEFORE UPDATE ON public.agent_conversations
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: owner-only
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_conversations'
      AND policyname = 'agent_conversations_owner_all'
  ) THEN
    CREATE POLICY agent_conversations_owner_all
      ON public.agent_conversations
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_messages'
      AND policyname = 'agent_messages_owner_all'
  ) THEN
    CREATE POLICY agent_messages_owner_all
      ON public.agent_messages
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.agent_conversations c
          WHERE c.id = agent_messages.conversation_id
            AND c.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.agent_conversations c
          WHERE c.id = agent_messages.conversation_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Service-role bypass is intentional: the agent server functions run with the
-- service-role client and enforce ownership in code (getConversation filters
-- by user_id), exactly like the other Phase 4 server surfaces.
-- ---------------------------------------------------------------------------
