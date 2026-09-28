/**
 * Phase 6 Stream E (P2) — Title format library (competitor pattern TI-3).
 *
 * The observed pattern: a ranked library of title templates (slots for the
 * creator's own topic/words), each tagged with the psychological lever it
 * pulls ("Utility Promise", "Curiosity Gap", …).
 *
 * HOW VIDORA'S IMPLEMENTATION DIFFERS (D301): Vidora's library is a pinned,
 * deterministic curator list — it does NOT fabricate "6.8× median"
 * performance multiples. No CTR claims are made anywhere; formats are a
 * packaging aid scored by the existing TitleScore heuristics, never a
 * virality prediction. The slot-fill is template-based and deterministic,
 * matching the Title Lab's no-LLM contract (D94/D101).
 *
 * Pure module — no I/O, no network, no randomness.
 */

export type FormatLever =
  | "Utility Promise"
  | "Curiosity Gap"
  | "Stakes"
  | "Specificity"
  | "Speed"
  | "Authority"
  | "Novelty"
  | "Comparison";

export interface FormatSlot {
  /** Slot key used in the template, e.g. "topic". */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  /** Example fill, e.g. "night trains". */
  example: string;
}

export interface TitleFormat {
  /** Stable id, e.g. "how-to-without". */
  id: string;
  /** Human name. */
  name: string;
  /** Template with [slot] markers. */
  template: string;
  slots: FormatSlot[];
  lever: FormatLever;
  /** One-line packaging note — a heuristic, never a performance claim. */
  note: string;
}

/**
 * Pinned, curator-ordered library. Templates are original phrasings in
 * Vidora's own voice; the pattern (ranked slot templates + lever labels) is
 * the only thing borrowed.
 */
export const TITLE_FORMATS: readonly TitleFormat[] = [
  {
    id: "how-to-without",
    name: "How-to without the pain",
    template: "How to [action] [thing] Without [action]",
    slots: [
      { key: "action", label: "Action", example: "edit" },
      { key: "thing", label: "Thing", example: "your videos" },
    ],
    lever: "Utility Promise",
    note: "Promises a desirable outcome while removing the expected cost.",
  },
  {
    id: "how-to-fix",
    name: "Fix-it promise",
    template: "How to Fix Your [thing]",
    slots: [{ key: "thing", label: "Thing", example: "retention" }],
    lever: "Utility Promise",
    note: "Speaks directly to a known pain point; works best for tutorials.",
  },
  {
    id: "what-happens",
    name: "Outcome tease",
    template: "What Happens When You [action]",
    slots: [{ key: "action", label: "Action", example: "stop posting daily" }],
    lever: "Curiosity Gap",
    note: "Opens a loop about an outcome the viewer wants to see resolved.",
  },
  {
    id: "number-mistakes",
    name: "Numbered mistakes",
    template: "[number] [thing] Mistakes That [consequence]",
    slots: [
      { key: "number", label: "Number", example: "7" },
      { key: "thing", label: "Thing", example: "thumbnail" },
      { key: "consequence", label: "Consequence", example: "kill your reach" },
    ],
    lever: "Stakes",
    note: "Numbered specificity plus a cost — strong for packaging audits.",
  },
  {
    id: "stop-doing",
    name: "Stop doing it wrong",
    template: "Stop [action] — Do This Instead",
    slots: [{ key: "action", label: "Action", example: "writing hooks like this" }],
    lever: "Stakes",
    note: "Challenges the viewer's current approach; high curiosity, use sparingly.",
  },
  {
    id: "in-time",
    name: "Time-boxed explainer",
    template: "[thing] Explained in [time]",
    slots: [
      { key: "thing", label: "Thing", example: "the algorithm" },
      { key: "time", label: "Time", example: "10 minutes" },
    ],
    lever: "Speed",
    note: "Sets a clear effort expectation — respects the viewer's time.",
  },
  {
    id: "truth-about",
    name: "Insider truth",
    template: "The Truth About [thing]",
    slots: [{ key: "thing", label: "Thing", example: "faceless channels" }],
    lever: "Authority",
    note: "Implies hidden knowledge; the video must actually deliver it.",
  },
  {
    id: "i-tried",
    name: "Experiment log",
    template: "I Tried [thing] for [duration]",
    slots: [
      { key: "thing", label: "Thing", example: "posting at 3am" },
      { key: "duration", label: "Duration", example: "30 days" },
    ],
    lever: "Specificity",
    note: "Concrete commitment makes the premise believable and testable.",
  },
  {
    id: "nobody-tells",
    name: "Untold angle",
    template: "[thing]: What Nobody Tells You",
    slots: [{ key: "thing", label: "Thing", example: "monetization" }],
    lever: "Novelty",
    note: "Positions the video as the missing piece in a crowded niche.",
  },
  {
    id: "vs",
    name: "Head-to-head",
    template: "[thing A] vs [thing B]: Which Wins?",
    slots: [
      { key: "thing A", label: "First option", example: "TubeMagic" },
      { key: "thing B", label: "Second option", example: "manual research" },
    ],
    lever: "Comparison",
    note: "Comparison frames convert search intent well; keep the verdict honest.",
  },
  {
    id: "is-worth-it",
    name: "Worth-it verdict",
    template: "Is [thing] Worth It in [year]?",
    slots: [
      { key: "thing", label: "Thing", example: "YouTube automation" },
      { key: "year", label: "Year", example: "2026" },
    ],
    lever: "Specificity",
    note: "Freshness-dated verdicts earn clicks from researchers; update yearly.",
  },
  {
    id: "beginner-to-pro",
    name: "Skill ladder",
    template: "[thing]: Beginner to Pro",
    slots: [{ key: "thing", label: "Thing", example: "scriptwriting" }],
    lever: "Utility Promise",
    note: "Promises a complete journey — the video needs a clear progression.",
  },
];

export function listTitleFormats(): TitleFormat[] {
  return [...TITLE_FORMATS];
}

export function getTitleFormat(id: string): TitleFormat | null {
  return TITLE_FORMATS.find((f) => f.id === id) ?? null;
}

/**
 * Fill a format template with values. Slots are matched case-sensitively on
 * the exact marker (e.g. "[thing]"); unfilled slots are left in place so the
 * UI can show what is missing. Deterministic.
 */
export function applyTitleFormat(
  format: TitleFormat,
  values: Record<string, string>,
): string {
  let out = format.template;
  for (const slot of format.slots) {
    const marker = `[${slot.key}]`;
    const value = (values[slot.key] ?? "").trim();
    if (value) out = out.split(marker).join(value);
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Build deterministic slot values from a topic/keyword pair for quick
 * "apply this format to my topic" flows: topic fills every slot, and when a
 * distinct keyword exists it produces a second fill.
 */
export function fillsForTopic(
  format: TitleFormat,
  topic: string,
  keyword?: string,
): Array<{ values: Record<string, string>; label: string }> {
  const clean = (s: string) => s.trim();
  const fills: Array<{ values: Record<string, string>; label: string }> = [];
  const topicFill: Record<string, string> = {};
  for (const slot of format.slots) topicFill[slot.key] = clean(topic);
  if (clean(topic)) fills.push({ values: topicFill, label: "topic" });
  const kw = clean(keyword ?? "");
  if (kw && kw.toLowerCase() !== clean(topic).toLowerCase()) {
    const kwFill: Record<string, string> = {};
    for (const slot of format.slots) kwFill[slot.key] = kw;
    fills.push({ values: kwFill, label: "keyword" });
  }
  return fills;
}
