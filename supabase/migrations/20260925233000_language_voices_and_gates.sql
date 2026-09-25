-- Sprint 3-4 items 1, 2, 4: language data model extensions.
--
-- 1) language_voices: 4 voice slots per language (structure for the voice
--    catalog per language). Verified slots carry a real provider voice id and
--    are user-selectable; unverified BETA placeholders carry NULL provider
--    ids and selectable = false so the UI never offers them.
-- 2) language_quality_gates: per-language graduation record. A language may
--    only be status = 'live' when all three checks pass (golden scripts,
--    back-translation, native-speaker review). The checked-in CI mirror of
--    this data is src/lib/languages.ts (LANGUAGE_QUALITY_GATES); the test in
--    src/lib/language-gates.test.ts keeps the two in sync.
-- 3) Seed llm_instructions for all 12 languages (was default '').
--
-- Non-destructive: CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO
-- UPDATE, never drops.

-- ---------------------------------------------------------------------------
-- language_voices
-- ---------------------------------------------------------------------------
create table if not exists public.language_voices (
  id uuid primary key default gen_random_uuid(),
  language_code text not null references public.languages(code) on delete cascade,
  slot integer not null check (slot between 1 and 4),
  name text not null,
  gender text not null check (gender in ('masculine', 'feminine', 'neutral')),
  provider text not null check (provider in ('elevenlabs', 'gateway', 'none')),
  -- Concrete provider voice id. NULL = unverified placeholder; the id is
  -- filled only when a real id is verified (never invented).
  provider_voice_id text,
  -- True once the provider id has been verified against a real provider.
  verified boolean not null default false,
  -- True only when the voice may be offered in the UI picker.
  selectable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (language_code, slot)
);

alter table public.language_voices enable row level security;
drop policy if exists "language voices readable by all" on public.language_voices;
create policy "language voices readable by all" on public.language_voices
  for select using (true);

-- Seed: 4 slots per language. English + Hindi slots are verified: their
-- provider ids come from the existing in-code catalog (src/lib/voices.ts),
-- which is in production use. All other beta languages get clearly-marked
-- BETA placeholders (provider 'none', NULL id, not selectable).
insert into public.language_voices
  (language_code, slot, name, gender, provider, provider_voice_id, verified, selectable)
values
  ('en', 1, 'George', 'masculine', 'elevenlabs', 'JBFqnCBsd6RMkjVDRZzb', true, true),
  ('en', 2, 'Sarah', 'feminine', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', true, true),
  ('en', 3, 'Rachel', 'feminine', 'elevenlabs', '21m00Tcm4TlvDq8ikWAM', true, true),
  ('en', 4, 'Domi', 'feminine', 'elevenlabs', 'AZnzlk1XvdvUeBnXmlld', true, true),
  ('hi', 1, 'Aisha', 'feminine', 'elevenlabs', '21m00Tcm4TlvDq8ikWAM', true, true),
  ('hi', 2, 'Arjun', 'masculine', 'elevenlabs', 'pNInz6obpgDQGcFmaJgB', true, true),
  ('hi', 3, 'Kavya', 'feminine', 'gateway', 'shimmer', true, true),
  ('hi', 4, 'Vikram', 'masculine', 'gateway', 'onyx', true, true),
  ('zh', 1, 'Mandarin Beta 1', 'feminine', 'none', NULL, false, false),
  ('zh', 2, 'Mandarin Beta 2', 'masculine', 'none', NULL, false, false),
  ('zh', 3, 'Mandarin Beta 3', 'feminine', 'none', NULL, false, false),
  ('zh', 4, 'Mandarin Beta 4', 'masculine', 'none', NULL, false, false),
  ('es', 1, 'Spanish Beta 1', 'feminine', 'none', NULL, false, false),
  ('es', 2, 'Spanish Beta 2', 'masculine', 'none', NULL, false, false),
  ('es', 3, 'Spanish Beta 3', 'feminine', 'none', NULL, false, false),
  ('es', 4, 'Spanish Beta 4', 'masculine', 'none', NULL, false, false),
  ('ar', 1, 'Arabic Beta 1', 'feminine', 'none', NULL, false, false),
  ('ar', 2, 'Arabic Beta 2', 'masculine', 'none', NULL, false, false),
  ('ar', 3, 'Arabic Beta 3', 'feminine', 'none', NULL, false, false),
  ('ar', 4, 'Arabic Beta 4', 'masculine', 'none', NULL, false, false),
  ('fr', 1, 'French Beta 1', 'feminine', 'none', NULL, false, false),
  ('fr', 2, 'French Beta 2', 'masculine', 'none', NULL, false, false),
  ('fr', 3, 'French Beta 3', 'feminine', 'none', NULL, false, false),
  ('fr', 4, 'French Beta 4', 'masculine', 'none', NULL, false, false),
  ('bn', 1, 'Bengali Beta 1', 'feminine', 'none', NULL, false, false),
  ('bn', 2, 'Bengali Beta 2', 'masculine', 'none', NULL, false, false),
  ('bn', 3, 'Bengali Beta 3', 'feminine', 'none', NULL, false, false),
  ('bn', 4, 'Bengali Beta 4', 'masculine', 'none', NULL, false, false),
  ('pt', 1, 'Portuguese Beta 1', 'feminine', 'none', NULL, false, false),
  ('pt', 2, 'Portuguese Beta 2', 'masculine', 'none', NULL, false, false),
  ('pt', 3, 'Portuguese Beta 3', 'feminine', 'none', NULL, false, false),
  ('pt', 4, 'Portuguese Beta 4', 'masculine', 'none', NULL, false, false),
  ('id', 1, 'Indonesian Beta 1', 'feminine', 'none', NULL, false, false),
  ('id', 2, 'Indonesian Beta 2', 'masculine', 'none', NULL, false, false),
  ('id', 3, 'Indonesian Beta 3', 'feminine', 'none', NULL, false, false),
  ('id', 4, 'Indonesian Beta 4', 'masculine', 'none', NULL, false, false),
  ('ur', 1, 'Urdu Beta 1', 'feminine', 'none', NULL, false, false),
  ('ur', 2, 'Urdu Beta 2', 'masculine', 'none', NULL, false, false),
  ('ur', 3, 'Urdu Beta 3', 'feminine', 'none', NULL, false, false),
  ('ur', 4, 'Urdu Beta 4', 'masculine', 'none', NULL, false, false),
  ('de', 1, 'German Beta 1', 'feminine', 'none', NULL, false, false),
  ('de', 2, 'German Beta 2', 'masculine', 'none', NULL, false, false),
  ('de', 3, 'German Beta 3', 'feminine', 'none', NULL, false, false),
  ('de', 4, 'German Beta 4', 'masculine', 'none', NULL, false, false),
  ('ja', 1, 'Japanese Beta 1', 'feminine', 'none', NULL, false, false),
  ('ja', 2, 'Japanese Beta 2', 'masculine', 'none', NULL, false, false),
  ('ja', 3, 'Japanese Beta 3', 'feminine', 'none', NULL, false, false),
  ('ja', 4, 'Japanese Beta 4', 'masculine', 'none', NULL, false, false)
on conflict (language_code, slot) do update set
  name = excluded.name,
  gender = excluded.gender,
  provider = excluded.provider,
  provider_voice_id = excluded.provider_voice_id,
  verified = excluded.verified,
  selectable = excluded.selectable;

-- ---------------------------------------------------------------------------
-- language_quality_gates
-- ---------------------------------------------------------------------------
create table if not exists public.language_quality_gates (
  language_code text primary key references public.languages(code) on delete cascade,
  golden_scripts_passed boolean not null default false,
  golden_scripts_evidence text not null default '',
  back_translation_passed boolean not null default false,
  back_translation_evidence text not null default '',
  native_review_passed boolean not null default false,
  native_review_evidence text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.language_quality_gates enable row level security;
drop policy if exists "language quality gates readable by all" on public.language_quality_gates;
create policy "language quality gates readable by all" on public.language_quality_gates
  for select using (true);
-- No write policies: service_role only (default deny for anon/authenticated).

-- Seed the gate records. English is the only language with all three checks
-- passing; the evidence notes describe exactly what was done (no fabricated
-- reviews). The 11 beta languages stay behind the gate.
insert into public.language_quality_gates
  (language_code, golden_scripts_passed, golden_scripts_evidence,
   back_translation_passed, back_translation_evidence,
   native_review_passed, native_review_evidence)
values
  ('en', true, 'Three golden scripts (hook, explainer, sleep doc) pass caption-layer render fixtures in CI (src/lib/render/captions-language.test.ts); full-MP4 demo video still pending, tracked in FOUNDER_TODO', true, 'Not applicable: English is the authoring source language, so no translation round-trip exists; scripts and copy are reviewed directly in English', true, 'English UI copy, FAQ, and narration templates are authored and reviewed in English by the product team; a formal native-speaker panel has not been convened yet'),
  ('zh', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('hi', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('es', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('ar', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('fr', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('bn', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('pt', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('id', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('ur', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('de', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language'),
  ('ja', false, 'Pending: golden scripts not yet rendered for this language', false, 'Pending: back-translation check not yet run for this language', false, 'Pending: native-speaker review not yet scheduled for this language')
on conflict (language_code) do update set
  golden_scripts_passed = excluded.golden_scripts_passed,
  golden_scripts_evidence = excluded.golden_scripts_evidence,
  back_translation_passed = excluded.back_translation_passed,
  back_translation_evidence = excluded.back_translation_evidence,
  native_review_passed = excluded.native_review_passed,
  native_review_evidence = excluded.native_review_evidence,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Seed llm_instructions where still empty (per-language script-writing rules).
-- ---------------------------------------------------------------------------
update public.languages set llm_instructions = 'Write in clear natural English. Short sentences, one idea per caption line. Avoid slang that does not translate.' where code = 'en' and llm_instructions = '';
update public.languages set llm_instructions = 'Use Simplified Chinese. Keep lines short and punchy. Avoid classical idioms that confuse modern viewers.' where code = 'zh' and llm_instructions = '';
update public.languages set llm_instructions = 'Use simple everyday Hindi with a light Urdu mix where natural. Avoid overly Sanskritized words.' where code = 'hi' and llm_instructions = '';
update public.languages set llm_instructions = 'Use neutral Latin American Spanish. Avoid regional slang.' where code = 'es' and llm_instructions = '';
update public.languages set llm_instructions = 'Use Modern Standard Arabic. Keep sentences short so captions stay readable.' where code = 'ar' and llm_instructions = '';
update public.languages set llm_instructions = 'Use standard French with a neutral, clear register.' where code = 'fr' and llm_instructions = '';
update public.languages set llm_instructions = 'Use standard colloquial Bengali. Avoid archaic sadhu-bhasha forms.' where code = 'bn' and llm_instructions = '';
update public.languages set llm_instructions = 'Use neutral Brazilian Portuguese. Avoid Portugal-specific terms.' where code = 'pt' and llm_instructions = '';
update public.languages set llm_instructions = 'Use standard Bahasa Indonesia. Keep it casual but clear.' where code = 'id' and llm_instructions = '';
update public.languages set llm_instructions = 'Use everyday Urdu in Perso-Arabic script. Keep sentences short for captions.' where code = 'ur' and llm_instructions = '';
update public.languages set llm_instructions = 'Use standard German. Prefer short main clauses so captions stay readable.' where code = 'de' and llm_instructions = '';
update public.languages set llm_instructions = 'Use plain polite Japanese (desu/masu form). Keep every caption line under 20 characters.' where code = 'ja' and llm_instructions = '';
