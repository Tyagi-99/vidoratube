-- Client error telemetry: captures the real JS error behind the root error
-- boundary so intermittent production crashes can be diagnosed from the DB.
--
-- Insert-only for everyone (anon + authenticated); there is deliberately NO
-- select policy, so only the service role can read the rows. No PII is
-- stored: message + stack + route + user-agent only.
-- Non-destructive: new table + policies only.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  stack text,
  route text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated
  with check (true);

comment on table public.client_errors is
  'Client-side crash telemetry from the root error boundary. Insert-only; reads are service-role only.';
