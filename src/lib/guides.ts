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
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
