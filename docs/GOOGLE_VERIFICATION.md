# Google OAuth Verification & YouTube API — Vidora AI

**Status (2026-09-25):** OAuth consent screen configured, scopes requested incrementally.
Verification NOT yet submitted. Publishing works in testing mode only (≤100 test users).

## 1. App summary (for the verification form)

- **App name:** Vidora AI (VidoraTube)
- **Homepage:** https://vidoratube.lovable.app/
- **What it does:** An AI YouTube studio. Users research niches, generate video scripts,
  voiceovers, visuals, and thumbnails with AI, then publish finished videos to their
  own YouTube channel after an explicit human approval step. Nothing auto-publishes.
- **Target users:** Individual creators and small content teams (initial focus: India, Hindi + English).

## 2. Scopes requested

| Scope | Why it's needed | Where it's used |
|---|---|---|
| `https://www.googleapis.com/auth/youtube.readonly` | Show the connected channel's identity (id, title) so the user knows which channel they're publishing to. | Connect step (`startYouTubeConnect`) |
| `https://www.googleapis.com/auth/youtube.upload` | Upload the user's own rendered video to their own channel and set its thumbnail. | Publish step only, granted incrementally (`requestUploadScope`) |

**Scope minimization:** connecting asks for read-only only. The upload scope is requested
incrementally at publish time with `include_granted_scopes=true`, so users who only want
analytics/research never grant upload access.

**Justification text (paste into the verification form):**

> `youtube.readonly` — Vidora AI displays the connected YouTube channel's name and ID in
> the publishing panel so users can confirm they are publishing to the correct channel
> before approving any upload. No video or analytics data is read.
>
> `youtube.upload` — After the user explicitly presses "Approve & publish", Vidora AI
> uploads the video file the user created in the studio to the user's own YouTube channel
> via the resumable upload protocol, applies the title/description/tags/privacy setting
> the user chose, and sets the thumbnail the user selected. Every upload requires a
> deliberate human approval; there is no automatic or scheduled-unattended publishing.

## 3. Demo video outline (required by Google)

Record a ≤5-minute screencast showing:

1. (0:00–0:30) Homepage → sign in → open a project.
2. (0:30–1:30) Connect YouTube: click Connect, Google consent screen appears showing
   ONLY the read-only scope; return to the app, channel name displayed.
3. (1:30–2:30) Open the Publish tab: generate a thumbnail, generate SEO metadata,
   pick visibility, answer the made-for-kids question.
4. (2:30–3:30) Click "Grant upload permission" — consent screen now shows the upload
   scope (incremental auth). Return to the app.
5. (3:30–4:30) Review step → press "Approve & publish" → upload progress → success
   with the youtu.be link. Open the video on YouTube to prove it landed.
6. (4:30–5:00) Show disconnect: revoke at Google, reconnect prompt appears.

Upload the video as **Unlisted** on YouTube and paste the link in the verification form.

## 4. Privacy policy & Terms checklist

Both must be publicly accessible links on the app's domain BEFORE submitting.

- [ ] Privacy policy page exists at `/privacy` covering: data collected (email, OAuth
      tokens), token storage (encrypted at rest), token use (YouTube upload only),
      data sharing (none sold; subprocessors: Supabase, Lovable), deletion requests
      (contact email), and Google API Services User Data Policy compliance statement.
- [ ] Terms of service page exists at `/terms` covering: acceptable use, no
      auto-publishing guarantee, credit billing, content ownership (user owns their
      videos), and DMCA/copyright contact.
- [ ] Both links are on the homepage footer AND on the OAuth consent screen
      (authorized domains must include `vidoratube.lovable.app` and later `vidora.ai`).
- [ ] App's privacy policy includes the sentence: "Vidora AI's use and transfer of
      information received from Google APIs will adhere to the Google API Services
      User Data Policy, including the Limited Use requirements."

## 5. Quota extension draft

Default quota: 10,000 units/day. A single video upload costs ~1,600 units
(`videos.insert`), so the default supports ~6 uploads/day — too low for launch.

**Draft request (submit via Google Cloud Console → YouTube Data API → Quotas):**

> Vidora AI (project: [PROJECT_ID]) is an AI video studio for YouTube creators.
> Users create videos in our editor and publish them to their own channels after
> explicit approval. We request an increase from 10,000 to 100,000 units/day.
>
> Usage estimate: ~50 publishing users/day × 1 upload (1,600 units) = 80,000 units,
> plus ~5,000 units for channel lookups and thumbnail sets. All uploads are
> user-initiated with human approval; we cache channel data for 24h and never
> poll. Quota monitoring alerts are configured at 80% usage.

Attach: demo video link, privacy policy URL, terms URL.

## 6. What still needs a human (cannot be automated)

1. Submitting the OAuth verification form in Google Cloud Console.
2. Recording and uploading the demo video.
3. Publishing `/privacy` and `/terms` pages (P10 compliance work).
4. A real Google account authorization end-to-end (test users only until verified).
5. The quota extension request submission.
