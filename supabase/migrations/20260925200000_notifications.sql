-- 20260925200000_notifications.sql
-- Sprint 1-2: in-app notifications table.
--
-- Non-destructive: brand-new table, no rows edited, no existing tables touched.
-- Purpose: the "close the tab" promise for renders. When a render finishes
-- (browser path or server worker path), a notification row is stored so the
-- user sees it in the app even if they never receive an email (email only
-- flows when RESEND_API_KEY is configured — see src/lib/notifications.server.ts).
--
-- RLS: users read their own rows; inserts/updates go through the service role
-- (server functions only), so no INSERT policy for anon/authenticated.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'render_complete',
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'notifications_select_own'
  ) then
    create policy notifications_select_own
      on public.notifications for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'notifications_update_own_read'
  ) then
    -- Users may only mark their own notifications read; nothing else may change.
    create policy notifications_update_own_read
      on public.notifications for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
