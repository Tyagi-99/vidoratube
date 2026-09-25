-- Sprint 3-4 foundation: languages table.
-- Vidora is language-neutral: every language is a row here, not a code branch.
-- Language behaviour (font, RTL, caption line length, voices, LLM instructions)
-- comes ONLY from this table. Components must never hardcode language names/codes.
--
-- Status: 'live' = release-blocking quality (English). 'beta' = behind the quality
-- gate (3 golden scripts + back-translation + native-speaker review).

create table if not exists languages (
  code text primary key,                    -- BCP-47-ish: 'en', 'ar', 'ja'
  name_en text not null,                     -- 'English', 'Arabic', 'Japanese'
  name_native text not null,                 -- 'English', 'العربية', '日本語'
  rtl boolean not null default false,        -- true for Arabic, Urdu
  font_stack text not null default 'system-ui',
  caption_max_chars integer not null default 42,
  llm_instructions text not null default '', -- per-language script-writing rules
  status text not null default 'beta'
    check (status in ('live', 'beta', 'planned')),
  created_at timestamptz not null default now()
);

-- RLS: readable by everyone (drives UI dropdowns), writable by service role only.
alter table languages enable row level security;
drop policy if exists "languages readable by all" on languages;
create policy "languages readable by all" on languages for select using (true);

-- Seed the 12 launch languages. English is the only 'live' language;
-- the other 11 enter as 'beta' and graduate through the quality gate.
insert into languages (code, name_en, name_native, rtl, font_stack, caption_max_chars, status) values
  ('en', 'English', 'English', false, 'system-ui', 42, 'live'),
  ('zh', 'Mandarin Chinese', '中文', false, '"Noto Sans SC", system-ui', 20, 'beta'),
  ('hi', 'Hindi', 'हिन्दी', false, '"Noto Sans Devanagari", system-ui', 42, 'beta'),
  ('es', 'Spanish', 'Español', false, 'system-ui', 42, 'beta'),
  ('ar', 'Modern Standard Arabic', 'العربية', true, '"Noto Sans Arabic", system-ui', 42, 'beta'),
  ('fr', 'French', 'Français', false, 'system-ui', 42, 'beta'),
  ('bn', 'Bengali', 'বাংলা', false, '"Noto Sans Bengali", system-ui', 42, 'beta'),
  ('pt', 'Portuguese', 'Português', false, 'system-ui', 42, 'beta'),
  ('id', 'Indonesian', 'Bahasa Indonesia', false, 'system-ui', 42, 'beta'),
  ('ur', 'Urdu', 'اردو', true, '"Noto Sans Arabic", system-ui', 42, 'beta'),
  ('de', 'German', 'Deutsch', false, 'system-ui', 42, 'beta'),
  ('ja', 'Japanese', '日本語', false, '"Noto Sans JP", system-ui', 20, 'beta')
on conflict (code) do update set
  name_en = excluded.name_en,
  name_native = excluded.name_native,
  rtl = excluded.rtl,
  font_stack = excluded.font_stack,
  caption_max_chars = excluded.caption_max_chars;
