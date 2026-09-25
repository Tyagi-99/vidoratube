-- P9: idempotent referral submission needs a unique key on (referrer_id, invitee_id).
-- Rows without an invitee (the referrer's own shareable-link placeholder) are
-- excluded so one placeholder per user is still possible.

alter table public.referrals
  add constraint referrals_referrer_invitee_key
  unique nulls not distinct (referrer_id, invitee_id);
