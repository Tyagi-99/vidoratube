/**
 * Phase 6 Stream E (P5) — multi-source project ingestion (competitor pattern SF-1).
 *
 * The observed pattern: start a project from several source types — a fresh
 * topic, a draft, a pasted transcript, article text, or a URL — rather than
 * topic-only creation.
 *
 * HOW VIDORA'S IMPLEMENTATION DIFFERS (D304): a `url` source is stored as a
 * reference only. Vidora NEVER fetches the URL server-side (SSRF/abuse
 * surface); the user pastes the content they want Vidora to work from into
 * the source text field. The source is kept as provenance on the project —
 * Vidora plans scenes from it but never re-publishes source text verbatim.
 *
 * Pure module — no I/O, no network.
 */

export const PROJECT_SOURCE_KINDS = ["topic", "draft", "transcript", "article", "url"] as const;

export type ProjectSourceKind = (typeof PROJECT_SOURCE_KINDS)[number];

/** Minimum characters for transcript/article sources (must be real content). */
export const SOURCE_TEXT_MIN_CHARS = 50;
/** Maximum characters stored on a source (keeps rows sane). */
export const SOURCE_TEXT_MAX_CHARS = 100_000;

export interface ProjectSourceInput {
  topic?: string | undefined;
  script?: string | undefined;
  sourceKind?: ProjectSourceKind | undefined;
  sourceText?: string | undefined;
  sourceUrl?: string | undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate a multi-source project input. Returns human-readable errors
 * (empty = valid). Deterministic.
 */
export function validateProjectSource(input: ProjectSourceInput): string[] {
  const errors: string[] = [];
  const kind = input.sourceKind ?? "topic";
  const topic = (input.topic ?? "").trim();
  const script = (input.script ?? "").trim();
  const sourceText = (input.sourceText ?? "").trim();
  const sourceUrl = (input.sourceUrl ?? "").trim();

  if (!PROJECT_SOURCE_KINDS.includes(kind)) {
    errors.push(`Unknown source type: ${kind}.`);
    return errors;
  }

  if (kind === "topic") {
    if (!topic && !script) errors.push("Give Vidora a topic or paste a script.");
  } else if (kind === "draft") {
    if (!script) errors.push("A draft source needs pasted script text.");
  } else if (kind === "transcript" || kind === "article") {
    if (sourceText.length < SOURCE_TEXT_MIN_CHARS) {
      errors.push(
        `${kind === "transcript" ? "A transcript" : "An article"} source needs at least ` +
          `${SOURCE_TEXT_MIN_CHARS} characters of pasted text.`,
      );
    }
    if (sourceText.length > SOURCE_TEXT_MAX_CHARS) {
      errors.push(
        `Pasted source text is too long (max ${SOURCE_TEXT_MAX_CHARS.toLocaleString()} characters).`,
      );
    }
  } else if (kind === "url") {
    if (!isHttpUrl(sourceUrl)) {
      errors.push("A URL source needs a valid http(s) link (stored as a reference only).");
    }
    if (sourceText.length > SOURCE_TEXT_MAX_CHARS) {
      errors.push(
        `Pasted source text is too long (max ${SOURCE_TEXT_MAX_CHARS.toLocaleString()} characters).`,
      );
    }
  }

  return errors;
}

/**
 * Derive the topic fallback for sources where the user gave content but no
 * title: first non-empty line of the pasted text, truncated.
 */
export function deriveTopicFromSource(sourceText: string, maxLen = 80): string {
  const firstLine = sourceText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Untitled project";
  return firstLine.length > maxLen ? `${firstLine.slice(0, maxLen - 1)}…` : firstLine;
}
