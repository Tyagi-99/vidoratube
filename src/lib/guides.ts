export type Guide = {
  slug: string;
  title: string;
  description: string;
  readingMinutes: number;
  sections: { heading: string; body: string[] }[];
};

export const GUIDES: Guide[] = [
  {
    slug: "ai-youtube-studio",
    title: "How an AI YouTube studio works",
    description:
      "What AI can (and can't) do in your video pipeline: research, scripting, voiceover, visuals, and rendering.",
    readingMinutes: 6,
    sections: [
      {
        heading: "The pipeline",
        body: [
          "A typical AI video pipeline has five stages: research (what to make), script, voiceover, visuals, and render. Vidora keeps all five in one place so you don't stitch tools together.",
          "Research tools find outliers — videos that got far more views than their channel usually gets — and turn those patterns into new ideas.",
        ],
      },
      {
        heading: "Where AI helps most",
        body: [
          "Voiceover is the biggest win: a consistent narrator voice in English or Hindi without a microphone or studio. Script drafting is second — AI gets you to a solid first draft fast, then you edit.",
          "Visuals are the weakest link. AI stills are great for b-roll and illustrations, but read every frame before publishing: garbled text and wrong details slip through.",
        ],
      },
      {
        heading: "Where humans stay in charge",
        body: [
          "You approve every publish. AI suggests titles, thumbnails, and schedules — you decide. That's not a limitation, it's the design: unattended publishing is how channels get demonetized.",
          "Fact-check anything the AI asserts. Treat AI output as a talented intern's draft, not a finished product.",
        ],
      },
    ],
  },
  {
    slug: "monetization-safety",
    title: "Keeping your channel monetized with AI-made videos",
    description:
      "What triggers limited ads on YouTube, and how to check your video before you publish.",
    readingMinutes: 7,
    sections: [
      {
        heading: "Why videos get limited ads",
        body: [
          "YouTube's advertiser-friendly guidelines flag profanity, sexual content, violence, drug references, and sensitive events in the title, description, or the video itself. One flagged line can limit ads on the whole video.",
          "Reused or barely-transformed content is the other big risk: compilations of other people's clips with no original commentary routinely get rejected from the Partner Program.",
        ],
      },
      {
        heading: "The pre-publish checklist",
        body: [
          "Read your script out loud and flag anything you'd hesitate to say to an advertiser. Check that your title and thumbnail honestly match the video — clickbait erodes trust and invites manual review.",
          "Verify every asset's license: music, images, and footage. Vidora records provenance for everything it generates so you can prove origin if you're ever reviewed.",
        ],
      },
      {
        heading: "What a safety score can and can't tell you",
        body: [
          "An automated score estimates risk based on public policy signals — keyword density, license coverage, metadata honesty. It's a second pair of eyes, not a guarantee. YouTube makes the final call.",
          "If a score is borderline, rewrite the flagged spans and re-check. Small wording changes move the needle a lot.",
        ],
      },
    ],
  },
  {
    slug: "hindi-ai-voice",
    title: "Making YouTube videos in Hindi with AI voiceover",
    description:
      "Why Hindi AI narration works for faceless channels, and how to pick a voice your audience trusts.",
    readingMinutes: 5,
    sections: [
      {
        heading: "Why Hindi voiceover works",
        body: [
          "Millions of Hindi-speaking viewers watch faceless explainers, finance, and storytelling channels daily. AI narration removes the biggest bottleneck — recording — while keeping the human feel that text-to-speech used to lack.",
          "Modern neural voices handle Hindi's rhythm and emphasis well, but always listen to a full minute before committing to a voice for a series.",
        ],
      },
      {
        heading: "Picking the right voice",
        body: [
          "Match the voice to the niche: warm and measured for finance and documentaries, energetic for entertainment and Shorts. Consistency matters more than perfection — audiences bond with a familiar narrator.",
          "Preview every voice with your own script, not the default sample. A voice that sounds great on a demo can feel wrong on your content.",
        ],
      },
      {
        heading: "Script tips for Hindi narration",
        body: [
          "Write the way people speak, not the way they write. Short sentences, natural pauses, and conversational transitions sound far better through AI voices.",
          "Watch for English loanwords — decide how you want them pronounced and keep it consistent across episodes.",
        ],
      },
    ],
  },
  {
    slug: "youtube-api-app-review",
    title: "YouTube API app review: the founder checklist",
    description:
      "Everything a founder must prepare and submit — in order — to get a YouTube Data API integration verified, audited, and quota-approved. Includes the exact OAuth scopes, the current quota model, and the audit rule that forces uploads private.",
    readingMinutes: 11,
    sections: [
      {
        heading: "What you're actually applying for",
        body: [
          "Shipping a 'publish to YouTube' feature means passing three separate Google/YouTube gates: OAuth verification (your app's identity and data handling), the YouTube API compliance audit (your app follows the YouTube API Services terms), and quota approval (how many uploads your project may do per day). They are reviewed by different teams on different timelines — plan for all three.",
          "Do this work before you promise users a launch date. Verification alone commonly takes several weeks, and a rejection restarts the clock.",
        ],
      },
      {
        heading: "The exact OAuth scopes you need",
        body: [
          "Request scopes incrementally — the minimum at each step. At connect time, ask only for https://www.googleapis.com/auth/youtube.readonly (enough to read the channel, never to publish). When the user first clicks Publish, upgrade to the two publish scopes: https://www.googleapis.com/auth/youtube.upload and https://www.googleapis.com/auth/youtube.force-ssl.",
          "Why two publish scopes: videos.insert (upload) and thumbnails.set accept youtube.upload, but scheduling a video — videos.update with status.publishAt — does NOT. It requires youtube, youtube.force-ssl, or youtubepartner, and youtube.upload alone gets a 403. youtube.force-ssl is the least-privileged of the three that covers it.",
          "Scope classification matters for review: youtube.upload is a SENSITIVE scope (not restricted). That means your app must pass Google OAuth verification, but you do not need a third-party security assessment. The YouTube API compliance audit below is separate and still applies.",
        ],
      },
      {
        heading: "Quota: the current model (verified September 2026)",
        body: [
          "Google changed the quota model: there is no longer one 10,000-unit pool with videos.insert costing 1,600. The current default allocation per Cloud project is: 100 videos.insert calls per day (their own bucket, 1 quota per call), 100 search.list calls per day (their own bucket, 1 quota per call), and 10,000 units per day shared across all other endpoints. All buckets reset at midnight Pacific Time.",
          "Typical per-call costs from the shared pool: channels.list 1, videos.list 1, videos.update 50, thumbnails.set 50, captions.insert 400, captions.delete 50, commentThreads.insert 50. A full publish (upload + schedule + thumbnail) costs 1 videos.insert bucket call plus about 100 shared-pool units.",
          "Plan the quota ask with real math: expected uploads per user per day × expected users, against the 100-uploads/day default. A quota extension is a separate request with its own justification — it is granted, never automatic. Monitor usage so a growth spike doesn't start failing uploads at midnight.",
        ],
      },
      {
        heading: "The audit rule that forces uploads private",
        body: [
          "Since July 28, 2020, every video uploaded through an unaudited API project is forced to PRIVATE — permanently. It cannot be made public through the API or YouTube Studio until the project passes the YouTube API compliance audit. This is the single most common launch blocker: the upload 'works' in testing, then nothing can go public.",
          "Budget the audit into the launch plan from day one. Until it passes, default every upload to private in the UI and say so plainly — users should never discover the limitation after clicking Publish.",
        ],
      },
      {
        heading: "1. Set up a dedicated Google Cloud project",
        body: [
          "Create one Cloud project per product — never share the project with unrelated apps, because quota, audit findings, and violations attach to the project. Enable the YouTube Data API v3 on it.",
          "Configure the OAuth consent screen as 'External', set the publishing status to 'In production', add every domain your app runs on as an authorized domain, and verify domain ownership in Search Console. Keep the scope list to the absolute minimum your feature needs (for uploads: youtube.upload plus youtube.force-ssl for scheduling — see the scopes section above) — every extra scope is extra review surface.",
        ],
      },
      {
        heading: "2. Publish your privacy policy and terms",
        body: [
          "Your privacy policy and terms of service must be live at public URLs before you submit. The policy has to describe, accurately: what Google user data you access, why you need each scope, how long you store tokens and data, how users revoke access and delete their data, and a contact email.",
          "Reviewers compare the policy against what the app actually does. Anything the app does that the policy doesn't mention — or vice versa — is a rejection.",
        ],
      },
      {
        heading: "3. Prepare brand assets and contacts",
        body: [
          "Use one consistent app name, logo, and support email across the consent screen, your homepage, and the verification form. Add a developer contact email you actually monitor — follow-up questions from the trust & safety team go there, and slow replies stall your review.",
        ],
      },
      {
        heading: "4. Record the demo video",
        body: [
          "Record an unlisted screencast (a few minutes) that shows: the full OAuth grant flow from the user's perspective, each requested scope being used in the app, how the user disconnects the integration and revokes access, and where their data gets deleted. Narrate what the reviewer is seeing — they review hundreds of these.",
        ],
      },
      {
        heading: "5. Submit OAuth verification, then the YouTube audit",
        body: [
          "Submit brand verification through the Cloud console with the video, policy links, and scope justifications — one justification per scope, tied to the exact feature that uses it (e.g. 'youtube.force-ssl is used only for videos.update when the user schedules a publish time').",
          "Separately, submit the YouTube API compliance audit: demonstrate ToS compliance (no spam, no misleading metadata, real functionality — not a thin wrapper), and document your data handling, retention, and deletion flows. Only after this audit passes can uploads go public.",
          "Request quota with a written justification tied to the bucket math above (uploads per user per day × expected users against the 100/day default). New projects start at the default allocation; extensions are granted, not automatic.",
        ],
      },
      {
        heading: "6. After approval: stay approved",
        body: [
          "Adding a scope or changing data handling triggers re-verification. The YouTube audit recurs — keep your compliance evidence (policies, deletion flows, quota math) current year-round, not just at submission time. Monitor quota usage so a growth spike doesn't start failing uploads at midnight.",
        ],
      },
    ],
  },
  {
    slug: "meta-app-review",
    title: "Meta (Facebook/Instagram) app review: the founder checklist",
    description:
      "Everything a founder must prepare and submit — in order — to get a Meta app approved for Facebook and Instagram publishing. Includes the exact permissions, the Page token flow, and both publish protocols.",
    readingMinutes: 10,
    sections: [
      {
        heading: "What you're actually applying for",
        body: [
          "Meta's app review grants your app individual permissions (now called use cases), one by one. Business verification — proving your company is real — is a separate prerequisite for most publishing permissions. And Instagram content publishing additionally requires a Facebook Page connected to an Instagram Business or Creator account; a personal Instagram account can't publish through the API.",
          "Apply for permissions only when the feature that uses them is built and testable. Reviewers test the real flow.",
        ],
      },
      {
        heading: "The exact permissions you need",
        body: [
          "Facebook Page publishing needs three permissions: pages_show_list (list the Pages the user manages), pages_read_engagement (read posted content), and pages_manage_posts (create, edit, delete posts). The person granting the token must hold the CREATE_CONTENT task on the Page — without it, uploads fail with a permissions error.",
          "Instagram publishing needs instagram_basic (read the account) and instagram_content_publish (publish through the container flow below). Request only what the app visibly uses — each permission needs its own written justification naming the exact feature and why it needs it.",
        ],
      },
      {
        heading: "Get the right token: Page tokens, not user tokens",
        body: [
          "This is the step that fails silently. Page operations need a Page access token, not the user token from Facebook Login. After OAuth, call GET /me/accounts with pages_show_list and take the Page's own access_token from the response — a user token against a Page edge returns permission errors that look like the object doesn't exist.",
          "Exchange the short-lived user token for a long-lived one first (GET /oauth/access_token with grant_type=fb_exchange_token), then derive the Page token from it. Page tokens obtained this way are long-lived. Resolve the linked Instagram account via GET /{page-id}?fields=instagram_business_account — that IG user id (not the username) is what every Instagram endpoint needs.",
        ],
      },
      {
        heading: "Facebook video: two upload methods",
        body: [
          "Simple method: POST /{page-id}/videos with file_url (a publicly reachable HTTPS URL of the MP4), title, and description. Meta's servers fetch the file. This covers most test flows and finished renders hosted on a public URL.",
          "Large-file method: the Resumable Upload API. POST /{app-id}/uploads with file_name, file_length, and file_type to start a session, transfer the bytes in chunks to the returned session, then publish with POST to https://graph-video.facebook.com/{page-id}/videos passing the file handle as fbuploader_video_file_chunk. Sessions survive interruptions — resume, don't restart.",
          "Scheduling: pass published=false with scheduled_publish_time (a Unix timestamp). Facebook requires the time to be at least 10 minutes in the future and at most 75 days out.",
        ],
      },
      {
        heading: "Instagram: the two-step container flow",
        body: [
          "Instagram publishing is always two steps. Step 1: POST /{ig-user-id}/media with media_type=REELS, video_url (fully public HTTPS — Meta's servers fetch it, no auth, no bot protection), caption, and share_to_feed=true. This returns a container id, not a post.",
          "Step 2: poll GET /{container-id}?fields=status_code until it reads FINISHED (video containers need 30–90 seconds; statuses are IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED). Only then call POST /{ig-user-id}/media_publish with creation_id set to the container id. Publishing before FINISHED fails; containers expire after 24 hours.",
          "Know the limits before you promise them: check GET /{ig-user-id}/content_publishing_limit at runtime for the account's quota (the documented number has changed over time — never hardcode it). Reels are vertical video; keep the caption within Instagram's limits and verify the video meets the duration and format requirements in the current docs.",
        ],
      },
      {
        heading: "1. Create and configure the Meta app",
        body: [
          "Create the app in the Meta App Dashboard and add the products you need (Facebook Login, and the Instagram product for IG publishing). Fill in the app icon, category, and contact email, then add live URLs for the privacy policy, terms of service, and — critically — a working data-deletion callback endpoint. Meta checks that these URLs resolve.",
        ],
      },
      {
        heading: "2. Complete business verification",
        body: [
          "Submit legal business documents (registration, tax document, or utility bill in the business name), verify your domain, and confirm a business phone number or email. Verification routinely takes several business days, so start it before you need the permissions — app review can't finish without it.",
        ],
      },
      {
        heading: "3. Request the permissions (see above), nothing more",
        body: [
          "Request exactly the permission set from 'The exact permissions you need' — pages_show_list, pages_read_engagement, pages_manage_posts for Facebook; instagram_basic and instagram_content_publish for Instagram. Each permission needs its own written justification naming the exact feature that uses it and why.",
          "Remove any permission the app doesn't visibly use before submitting. Unused scopes are the most common avoidable delay in review.",
        ],
      },
      {
        heading: "4. Make the app reviewer-ready",
        body: [
          "Create Meta test users with the right roles and make sure a reviewer can log in and reach the publishing flow with zero help from you: working test credentials, a seeded demo account with connected Pages, and no dead ends. If the reviewer can't complete the flow, that's an automatic rejection.",
        ],
      },
      {
        heading: "5. Record one screencast per permission",
        body: [
          "For every permission you request, record a short screencast showing: login, the exact feature that uses the permission (e.g. composing and scheduling a post), and logout/disconnect. Narrate which permission is being exercised and where. Generic product tours get rejected — the reviewer must see the permission in use.",
        ],
      },
      {
        heading: "6. Submit, respond, and stay approved",
        body: [
          "Submit and watch the developer inbox: most reviews land within days to a couple of weeks. The common rejections are a permission that isn't visibly used in the screencast, a broken test login, and missing policy or deletion URLs — all fixable, all resubmittable.",
          "Staying approved is recurring work: Meta requires the annual Data Use Checkup to keep permissions, and adding a new permission means a new review. Keep your policies, test users, and deletion endpoint live year-round.",
        ],
      },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
