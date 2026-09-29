/**
 * Public marketing catalog of everything Vidora includes (D309).
 *
 * This is the single source of truth for the marketing site's feature
 * showcase: the homepage OS map and the /features page both render from
 * here. It is intentionally separate from docs/FEATURE_MATRIX.md, which is
 * the engineering inventory.
 *
 * Honesty rules (D311):
 * - One sentence per feature. No guarantees, no virality predictions, no
 *   income claims, no fabricated social proof.
 * - Anything estimate-based says so in the sentence.
 * - Features that need an unconfigured provider say which key they need.
 * - Not-yet-built items (Chrome extension, short-form engine, Meta UI)
 *   are labeled with a badge AND say so in the sentence.
 * - `route` is the real app route a signed-in user lands on, verified
 *   against src/routes. Nothing invented.
 */

import { VOICE_CHARACTERS } from "./voice-intel/catalog";

/** Derived from code (D307) — marketing copy must never hardcode this. */
const BUILT_IN_VOICE_COUNT = VOICE_CHARACTERS.length;

export type CatalogBadge = "Needs a key" | "Shipping next" | "Design only";

export interface CatalogFeature {
  /** Display name. */
  name: string;
  /** One honest sentence. See honesty rules above. */
  description: string;
  /** Real app route for signed-in users. Must start with "/". */
  route: string;
  /** Optional honest-state badge. */
  badge?: CatalogBadge;
}

export interface CatalogPillar {
  /** URL anchor on /features, e.g. "discover". */
  id: string;
  /** Pillar name. */
  name: string;
  /** One-line promise. */
  tagline: string;
  /** Main app route for this pillar. */
  route: string;
  features: CatalogFeature[];
}

export const FEATURE_CATALOG: CatalogPillar[] = [
  {
    id: "discover",
    name: "Discover",
    tagline: "Find what to make before you make it.",
    route: "/intelligence",
    features: [
      {
        name: "Niche Finder",
        description:
          "Scores niches on demand, competition, velocity and freshness with every factor shown — estimates are labeled, and it shows an honest unconfigured state until you add a YouTube Data API key.",
        route: "/intelligence/niches",
        badge: "Needs a key",
      },
      {
        name: "Channel Blueprints",
        description:
          "Turns a scored niche into a positioning, content-pillar, format and cadence plan using fixed rules — no LLM, no invented data.",
        route: "/intelligence/niches",
      },
      {
        name: "Channel Explorer",
        description:
          "Searches and compares channels with real subscriber snapshots and growth sorting once you connect a YouTube Data API key; similar-channel suggestions are labeled estimates.",
        route: "/intelligence/channels",
        badge: "Needs a key",
      },
      {
        name: "Outlier Explorer",
        description:
          "Ranks videos by outlier score — latest views divided by the channel's median — with velocity and confidence shown, and one click turns an outlier into a real script draft; needs a YouTube Data API key.",
        route: "/intelligence/outliers",
        badge: "Needs a key",
      },
      {
        name: "Video Intelligence",
        description:
          "Breaks down any video's packaging, publishing and performance facts side by side — descriptive only, no AI opinions; needs a YouTube Data API key.",
        route: "/intelligence/videos",
        badge: "Needs a key",
      },
      {
        name: "Trend Radar",
        description:
          "Surfaces trends from real view-velocity across your snapshots, with every trend citing at least one saved source; needs a YouTube Data API key.",
        route: "/intelligence/trends",
        badge: "Needs a key",
      },
      {
        name: "Smart Folders",
        description:
          "Rule-based folders that organize your research assets automatically — rules run server-side, no manual sorting.",
        route: "/intelligence/folders",
      },
      {
        name: "Watchtower alerts",
        description:
          "Watches competitors for breakout videos, title patterns and growth spikes, and turns each hit into a draft idea — checks run on demand.",
        route: "/intelligence/alerts",
      },
    ],
  },
  {
    id: "validate",
    name: "Validate",
    tagline: "Prove the idea before you spend a credit.",
    route: "/create",
    features: [
      {
        name: "Idea Engine",
        description:
          "Scores ideas on four disclosed factors — outlier alignment, hook strength, feasibility, safety — with thin evidence lowering confidence instead of faking it. Never a virality prediction.",
        route: "/create",
      },
      {
        name: "Visual Research",
        description:
          "A per-project canvas for sources, clips and references with type badges, stale flags and claim counts.",
        route: "/research",
      },
      {
        name: "Deep Research · Evidence Desk",
        description:
          "Extracts claims from your sources deterministically and links each to its evidence; strict mode blocks script approval and publishing on unsupported claims until you confirm or waive them.",
        route: "/research",
      },
      {
        name: "Title Lab",
        description:
          "Generates title variants from templates and scores them on disclosed length, keyword, curiosity and clarity heuristics — packaging help, never CTR predictions.",
        route: "/create/titles",
      },
      {
        name: "Title format library",
        description:
          "Twelve original title formats with fill-in slots, built into Title Lab as starting points.",
        route: "/create/titles",
      },
      {
        name: "Title word vectors",
        description:
          "Finds word and phrase patterns in your own tracked outliers — it needs at least ten of your videos to say anything, and says “not enough data” below that.",
        route: "/create/titles",
      },
      {
        name: "Thumbnail Studio",
        description:
          "A layered canvas editor with AI variant generation; an honest “image provider not connected” state until you add a key — never fake images.",
        route: "/thumbnails",
        badge: "Needs a key",
      },
      {
        name: "Thumbnail surface preview",
        description:
          "Shows your thumbnail at the small sizes YouTube actually displays — home, search, suggested, mobile — labeled as approximations.",
        route: "/thumbnails",
      },
    ],
  },
  {
    id: "create",
    name: "Create",
    tagline: "Script to finished video, scene by scene.",
    route: "/studio",
    features: [
      {
        name: "Script Studio",
        description:
          "Section-based editor with append-only version history, diff and restore, estimated timing at 150 words per minute, and draft → review → approve → lock enforced on the server.",
        route: "/create",
      },
      {
        name: "Brand Voice profiles",
        description:
          "Saved voice profiles whose vocabulary carries into script generation — data and binding, no guessing when several profiles exist.",
        route: "/create/brand-voices",
      },
      {
        name: "Character System",
        description:
          "Character cards with validated reference uploads bound to scenes; visual consistency across scenes is not yet verified — the UI says so.",
        route: "/characters",
      },
      {
        name: "Voice Studio",
        description: `${BUILT_IN_VOICE_COUNT} built-in voices out of the box, plus your own uploads and legal-gated cloning; provider voices need an ElevenLabs key.`,
        route: "/voices",
        badge: "Needs a key",
      },
      {
        name: "Stock Media",
        description:
          "Searches licensed stock with per-asset rights tracking; an honest “not connected” state until you add a Pexels or Pixabay key.",
        route: "/studio",
        badge: "Needs a key",
      },
      {
        name: "Video Studio",
        description:
          "Scene-based assembly with per-scene regeneration, QC checks, and music auto-ducked under the voiceover.",
        route: "/studio",
      },
      {
        name: "Render Checkpoints",
        description:
          "Scene-level checkpoints with resume after restart and targeted repair — narration, audio, visual or timing — instead of re-rendering everything.",
        route: "/studio",
      },
      {
        name: "30-Second Quick Create",
        description:
          "One input through eleven stages — idea, research, script, scenes, voiceover, visuals, assembly, QC, captions, music, render — with paid stages honestly skipped until you approve spend.",
        route: "/create/quick-create",
      },
      {
        name: "Shorts Repurposing",
        description:
          "Rule-based hook-first recut of long-form into 9:16 shorts with a duration cap; never auto-publishes.",
        route: "/studio",
      },
      {
        name: "Idea → Campaign",
        description:
          "Turns one approved idea into a multi-format package — long-form, shorts, thumbnails, titles, metadata — with artifacts starting as plans, never fabricated deliverables.",
        route: "/create/campaigns",
      },
      {
        name: "SEO & Metadata Studio",
        description:
          "Title variants, description and hashtag templates, and three thumbnail concepts — composition and short overlay text, never generated images.",
        route: "/create/seo-studio",
      },
      {
        name: "Short-Form Engine",
        description:
          "The end-to-end shorts generation pipeline — shipping next; the product says so today instead of pretending it exists.",
        route: "/studio",
        badge: "Shipping next",
      },
      {
        name: "Brand Library",
        description:
          "Workspace-scoped brand assets — logos, colors, fonts — shared across the studio.",
        route: "/agency",
      },
    ],
  },
  {
    id: "publish",
    name: "Publish",
    tagline: "Ship it, with a human in the loop.",
    route: "/publish",
    features: [
      {
        name: "YouTube Connection",
        description:
          "OAuth channel connection with encrypted tokens, connection health and quota visibility.",
        route: "/publish",
      },
      {
        name: "Content Calendar",
        description:
          "Week, month and pipeline views for scheduling; drag to reschedule — nothing auto-publishes.",
        route: "/publish/calendar",
      },
      {
        name: "Review Studio",
        description:
          "Approval queue with server-only approvals; low scores block public release and rejections are terminal with an audit trail.",
        route: "/publish/review",
      },
      {
        name: "Packaging Checklist",
        description:
          "Advisory pre-publish checklist — title, description, tags, privacy, safety, schedule — where dismissals need a reason and never bypass safety or approval gates.",
        route: "/publish/review",
      },
      {
        name: "Meta publishing",
        description:
          "Backend complete for Facebook and Instagram; the UI ships once Meta app review passes.",
        route: "/publish",
        badge: "Shipping next",
      },
    ],
  },
  {
    id: "measure",
    name: "Measure",
    tagline: "Know what worked, honestly.",
    route: "/analytics",
    features: [
      {
        name: "Analytics Dashboard",
        description:
          "Ingestion with a required source label — fixture data is marked DEMO DATA — and 28-day deltas that say “insufficient history” instead of inventing a baseline; live data needs a YouTube Analytics API key.",
        route: "/analytics",
        badge: "Needs a key",
      },
      {
        name: "Content Buckets",
        description:
          "Bucket-level performance derived from your real project metadata — labels are never invented.",
        route: "/analytics/buckets",
      },
      {
        name: "Scene-aware Retention",
        description:
          "Retention curves mapped over real chapter durations, with the weakest scene diagnosed from real data points only.",
        route: "/analytics/retention",
      },
      {
        name: "Channel Audit",
        description:
          "Automated channel health audit; every finding is evidenced, and AI-mined ones are labeled as AI analysis.",
        route: "/analytics/audit",
      },
      {
        name: "Packaging Experiments",
        description:
          "Title and thumbnail A/B tests with sample-size floors and a 24-hour minimum before any conclusion.",
        route: "/experiments",
      },
      {
        name: "Comment Intelligence",
        description:
          "Mines comments into audience requests and ideas with rule-based classification; draft replies need your confirm, nothing auto-deletes; needs a YouTube Data API key.",
        route: "/comments",
        badge: "Needs a key",
      },
      {
        name: "Monetization Studio",
        description:
          "Revenue tracking where RPM and CPM are always labeled estimates — never guarantees; live revenue needs a YouTube Analytics API key.",
        route: "/analytics/monetization",
        badge: "Needs a key",
      },
      {
        name: "ROI Studio",
        description:
          "Cost per video from your real credit ledger — refunds counted — with unattributed spend shown instead of hidden.",
        route: "/analytics/roi",
      },
    ],
  },
  {
    id: "learn",
    name: "Learn",
    tagline: "Turn outcomes into instincts — and run the team on one OS.",
    route: "/learnings",
    features: [
      {
        name: "Learning Engine",
        description:
          "Evidence-gated learnings from real outcomes, grouped by topic; AI-mined insights are labeled as AI analysis.",
        route: "/learnings",
      },
      {
        name: "Vidora Agent",
        description:
          "A conversational strategist with real tools and credit preflight per turn; every recommendation ends as a draft project — it can never publish or spend without you.",
        route: "/agent",
      },
      {
        name: "Team Workspaces",
        description:
          "Roles, scoped permissions, invites and a full audit log — owner to viewer to client seats.",
        route: "/agency",
      },
      {
        name: "API & MCP",
        description:
          "Scoped, revocable API keys and a JSON-RPC MCP server so your own tools can drive Vidora — every call authenticated and audited.",
        route: "/settings/api-keys",
      },
      {
        name: "Chrome Extension",
        description:
          "The architecture and token model are designed and documented; the extension itself is not built yet.",
        route: "/settings/api-keys",
        badge: "Design only",
      },
      {
        name: "Production Readiness",
        description:
          "A public diagnostics page running real system checks — database, storage, AI gateway, providers, render worker.",
        route: "/status",
      },
      {
        name: "Credits & Budgets",
        description:
          "Every AI action shows its cost up front and debits into an auditable ledger, with workspace and project budgets.",
        route: "/billing",
      },
    ],
  },
];

/** Total marketable features across all pillars. */
export const TOTAL_CATALOG_FEATURES = FEATURE_CATALOG.reduce(
  (sum, pillar) => sum + pillar.features.length,
  0,
);

/** Pillar ids, for anchor links. */
export const PILLAR_IDS = FEATURE_CATALOG.map((p) => p.id);
