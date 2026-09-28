/**
 * Phase 6 Stream E (P6) — pre-publish packaging checklist (competitor pattern AT-10).
 *
 * The observed pattern: before publishing, run a packaging checklist over
 * the job (title, description, tags, privacy, …) with per-rule
 * dismiss-with-reason — the dismissal carries into future runs, and the
 * checklist is advisory: it never gates the publish itself.
 *
 * HOW VIDORA'S IMPLEMENTATION DIFFERS (D305): Vidora's rules are pinned in
 * this module (CHECKLIST_VERSION) and evaluated against the real
 * `publish_jobs` row. Fails here are packaging advice; the strict
 * evidence/safety/approval gates (e.g. the safety_score < 50 block in
 * approvePublishJob, D61) are NOT touched by dismissals. A dismissal only
 * quiets the checklist's own warning for that rule id at this version.
 *
 * Pure module — no I/O, no network.
 */

/** Bump when a rule is added/changed: re-arms that rule's old dismissals. */
export const CHECKLIST_VERSION = 1;

export type ChecklistSeverity = "fail" | "warn";

export interface ChecklistRule {
  id: string;
  label: string;
  severity: ChecklistSeverity;
  /** What the user should do about it. */
  hint: string;
}

export interface ChecklistInput {
  title: string | null;
  description: string | null;
  tags: string[] | null;
  privacy: string | null;
  safety_score: number | null;
  scheduled_for: string | null;
}

export interface ChecklistFinding extends ChecklistRule {
  passed: boolean;
  /** Human detail about the current value (never invented). */
  detail: string;
}

export const CHECKLIST_RULES: readonly ChecklistRule[] = [
  {
    id: "title_present",
    label: "Video title is set",
    severity: "fail",
    hint: "Enter a title before approving — YouTube requires one.",
  },
  {
    id: "title_length",
    label: "Title length is reasonable",
    severity: "warn",
    hint: "Aim for 5–100 characters: descriptive at a glance, complete in search.",
  },
  {
    id: "description_present",
    label: "Description is set",
    severity: "fail",
    hint: "Write a description — it feeds search and the first lines show under the video.",
  },
  {
    id: "description_length",
    label: "Description has substance",
    severity: "warn",
    hint: "50+ characters lets you state the premise and add links/chapters.",
  },
  {
    id: "tags_count",
    label: "At least 3 tags",
    severity: "warn",
    hint: "A few specific tags help discovery; you can add more at approval.",
  },
  {
    id: "privacy_set",
    label: "Privacy is chosen",
    severity: "fail",
    hint: "Pick private, unlisted, or public before approving.",
  },
  {
    id: "safety_scored",
    label: "Safety score computed",
    severity: "warn",
    hint: "Run the safety check so the score is visible at approval. The strict safety gate still applies regardless.",
  },
  {
    id: "schedule_future",
    label: "Schedule is in the future",
    severity: "warn",
    hint: "A scheduled time in the past will publish immediately or fail.",
  },
];

function find(rule: ChecklistRule, passed: boolean, detail: string): ChecklistFinding {
  return { ...rule, passed, detail };
}

/** Evaluate every pinned rule against the job. Deterministic. */
export function evaluateChecklist(input: ChecklistInput): ChecklistFinding[] {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const tags = (input.tags ?? []).filter((t) => t.trim().length > 0);
  const now = Date.now();
  const scheduledMs = input.scheduled_for ? Date.parse(input.scheduled_for) : NaN;

  return [
    find(
      CHECKLIST_RULES[0] as ChecklistRule,
      title.length > 0,
      title.length > 0 ? `"${title.slice(0, 60)}${title.length > 60 ? "…" : ""}"` : "No title set",
    ),
    find(
      CHECKLIST_RULES[1] as ChecklistRule,
      title.length >= 5 && title.length <= 100,
      `${title.length} characters`,
    ),
    find(
      CHECKLIST_RULES[2] as ChecklistRule,
      description.length > 0,
      description.length > 0 ? `${description.length} characters` : "No description",
    ),
    find(
      CHECKLIST_RULES[3] as ChecklistRule,
      description.length >= 50,
      `${description.length} characters`,
    ),
    find(
      CHECKLIST_RULES[4] as ChecklistRule,
      tags.length >= 3,
      `${tags.length} tag${tags.length === 1 ? "" : "s"}`,
    ),
    find(
      CHECKLIST_RULES[5] as ChecklistRule,
      ["private", "unlisted", "public"].includes((input.privacy ?? "").toLowerCase()),
      input.privacy ? `privacy: ${input.privacy}` : "Privacy not chosen",
    ),
    find(
      CHECKLIST_RULES[6] as ChecklistRule,
      typeof input.safety_score === "number",
      typeof input.safety_score === "number"
        ? `score ${input.safety_score}`
        : "Not scored yet",
    ),
    find(
      CHECKLIST_RULES[7] as ChecklistRule,
      !input.scheduled_for || Number.isNaN(scheduledMs) || scheduledMs > now,
      input.scheduled_for
        ? `scheduled ${input.scheduled_for}`
        : "Not scheduled — publishes on approval",
    ),
  ];
}

/** Rules that did not pass, preserving pinned order. */
export function openFindings(findings: ChecklistFinding[]): ChecklistFinding[] {
  return findings.filter((f) => !f.passed);
}
