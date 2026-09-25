-- P9: Referral program
-- Invite links /r/{code}; 5 credits to each side when the invitee verifies
-- email. Anti-abuse: referral rows are claimed at most once; the reward is
-- granted through grant_credits_once with a deterministic ref so replays can
-- never double-grant.

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  referrer_id uuid not null references auth.users (id) on delete cascade,
  invitee_id uuid references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rewarded')),
  device_hash text,
  ip_prefix text,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz
);

create index referrals_referrer_idx on public.referrals (referrer_id);
create index referrals_invitee_idx on public.referrals (invitee_id);
create index referrals_code_idx on public.referrals (code);

alter table public.referrals enable row level security;

-- Referrers can read their own referrals; nobody else can.
create policy "owner read own referrals"
  on public.referrals for select
  using (auth.uid() = referrer_id);

-- Rows are created/updated by the service role only (server functions).
-- No insert/update/delete policies for authenticated users.
