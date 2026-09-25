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
      "Everything a founder must prepare and submit — in order — to get a YouTube Data API integration verified, audited, and quota-approved.",
    readingMinutes: 9,
    sections: [
      {
        heading: "What you're actually applying for",
        body: [
          "Shipping a 'publish to YouTube' feature means passing three separate Google/YouTube gates: OAuth verification (your app's identity and data handling), the YouTube API compliance audit (your app follows the YouTube API Services terms), and quota approval (how many uploads your project may do per day). They are reviewed by different teams on different timelines — plan for all three.",
          "Do this work before you promise users a launch date. Verification alone commonly takes several weeks, and a rejection restarts the clock.",
        ],
      },
      {
        heading: "1. Set up a dedicated Google Cloud project",
        body: [
          "Create one Cloud project per product — never share the project with unrelated apps, because quota, audit findings, and violations attach to the project. Enable the YouTube Data API v3 on it.",
          "Configure the OAuth consent screen as 'External', set the publishing status to 'In production', add every domain your app runs on as an authorized domain, and verify domain ownership in Search Console. Keep the scope list to the absolute minimum your feature needs (for uploads, typically the youtube.upload and youtube scopes) — every extra scope is extra review surface.",
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
          "Submit brand verification through the Cloud console with the video, policy links, and scope justifications. Separately, YouTube requires an API compliance audit for apps using its API: demonstrate ToS compliance (no spam, no misleading metadata, real functionality — not a thin wrapper), and document your data handling and retention.",
          "Request quota with a written justification tied to real usage math (uploads per user per day × expected users). New projects start at the default quota; extensions are granted, not automatic.",
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
      "Everything a founder must prepare and submit — in order — to get a Meta app approved for Facebook and Instagram publishing.",
    readingMinutes: 8,
    sections: [
      {
        heading: "What you're actually applying for",
        body: [
          "Meta's app review grants your app individual permissions (now called use cases), one by one. Business verification — proving your company is real — is a separate prerequisite for most publishing permissions. And Instagram content publishing additionally requires a Facebook Page connected to an Instagram Business or Creator account; a personal Instagram account can't publish through the API.",
          "Apply for permissions only when the feature that uses them is built and testable. Reviewers test the real flow.",
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
        heading: "3. Request the minimum permissions",
        body: [
          "Typical publishing stacks need pages_manage_posts and pages_read_engagement for Facebook Pages, plus instagram_basic and instagram_content_publish for Instagram. Request only what the app visibly uses — each permission needs its own written justification explaining exactly which feature uses it and why.",
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
