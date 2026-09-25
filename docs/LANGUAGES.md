# Languages

Vidora is **language-neutral, English by default**. Language behaviour —
fonts, RTL, caption line length, voices, LLM script instructions — comes
**only** from the `languages` table, never from hardcoded branches in
components (enforced by `src/lib/language-neutrality.test.ts`).

## The 12 launch languages

| Code | Language | Status | RTL | Font stack | Caption chars | Voices |
|------|----------|--------|-----|------------|---------------|--------|
| en | English | **live** | no | system-ui | 42 | 4 verified, selectable |
| zh | Mandarin Chinese | beta | no | Noto Sans SC | 20 | 4 BETA placeholders |
| hi | Hindi | beta | no | Noto Sans Devanagari | 42 | 4 verified, selectable |
| es | Spanish | beta | no | system-ui | 42 | 4 BETA placeholders |
| ar | Modern Standard Arabic | beta | **yes** | Noto Sans Arabic | 42 | 4 BETA placeholders |
| fr | French | beta | no | system-ui | 42 | 4 BETA placeholders |
| bn | Bengali | beta | no | Noto Sans Bengali | 42 | 4 BETA placeholders |
| pt | Portuguese | beta | no | system-ui | 42 | 4 BETA placeholders |
| id | Indonesian | beta | no | system-ui | 42 | 4 BETA placeholders |
| ur | Urdu | beta | **yes** | Noto Sans Arabic | 42 | 4 BETA placeholders |
| de | German | beta | no | system-ui | 42 | 4 BETA placeholders |
| ja | Japanese | beta | no | Noto Sans JP | 20 | 4 BETA placeholders |

English is the only `live` language. The 11 betas are **not claimed as
available anywhere in public copy** — the site says "English narration —
more languages coming."

## Quality gate

A language may only graduate to `live` when all three checks pass:

1. **Golden scripts** — 3 golden scripts (hook, explainer, sleep doc)
   rendered acceptably through the caption/ffmpeg layer with passing
   assertions (`src/lib/render/captions-language.test.ts`).
2. **Back-translation** — script translated out and back; meaning preserved.
3. **Native-speaker review** — sign-off by a native speaker.

The production record is the `language_quality_gates` table
(RLS: public read, service-role write). The checked-in CI mirror is
`LANGUAGE_QUALITY_GATES` in `src/lib/languages.ts`; the test in
`src/lib/language-gates.test.ts` **fails** if any `live` language lacks
all three passing checks, and keeps the migration seed and the mirror
in sync.

Per-language gate status (honest evidence in the table / data mirror):

| Code | Golden scripts | Back-translation | Native review |
|------|----------------|------------------|---------------|
| en | ✅ pass — 3 scripts pass caption-layer fixtures in CI; full-MP4 demo still pending | ✅ pass — N/A, English is the authoring source language | ✅ pass — copy authored/reviewed in English by the product team; no formal panel convened yet |
| zh, hi, es, ar, fr, bn, pt, id, ur, de, ja | ⏳ pending | ⏳ pending | ⏳ pending |

## Voice slots

`language_voices` holds 4 slots per language. A slot is user-selectable
only when `verified = true` **and** `selectable = true`:

- **en**: George, Sarah, Rachel, Domi — verified ElevenLabs ids from the
  production catalog.
- **hi**: Aisha, Arjun, Kavya, Vikram — verified ids from the production
  catalog (Hindi stays beta as a language; its voices were already live
  in the picker, so removing them would be a product regression — D26).
- **Other 10 betas**: clearly-marked BETA placeholders (`provider = 'none'`,
  `provider_voice_id = NULL`, `selectable = false`). Real ids are wired
  **only** when verified against a real provider — never invented.

The UI picker (`VoicePicker`) filters through `userSelectableVoices()`,
so placeholders can never be offered until verified.

## Graduating a beta language

1. Verify 4 provider voice ids → set `verified`/`selectable` (service role).
2. Pass the 3 golden scripts; record evidence in `language_quality_gates`.
3. Run back-translation; record evidence.
4. Get native-speaker sign-off; record evidence.
5. Flip `languages.status` to `live` (service role). The gate test then
   enforces the invariant in CI.

## Caption rendering per language

- **Font**: the ASS style's Fontname is the primary family of the row's
  `font_stack` (generic stacks like `system-ui` fall back to Inter, which
  is what the render pipeline ships).
- **RTL** (`ar`, `ur`): the ASS file is marked `; Direction: RTL` and
  text is kept in logical (reading) order — libass applies the Unicode
  bidi algorithm at burn-in. The canvas caption path sets
  `ctx.direction = "rtl"`.
- **Line length**: cues wrap at `caption_max_chars` characters; words
  longer than the budget (e.g. spaceless CJK text) are split by character,
  so `ja`/`zh` wrap at 20 chars per line.
