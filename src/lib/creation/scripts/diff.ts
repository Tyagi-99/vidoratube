/**
 * F12 — version diffing for the Script Studio history view.
 *
 * Pure + deterministic: compares two section lists by section id and reports
 * added / removed / modified / moved sections. Powers the "what changed
 * between v3 and v4" view; never touches the database.
 */
import type { ScriptSection } from "./types";

export type ScriptDiffType = "added" | "removed" | "modified" | "moved";

export type ScriptDiff = {
  type: ScriptDiffType;
  sectionId: string;
  heading: string;
  before: { heading: string; body: string } | null;
  after: { heading: string; body: string } | null;
  fromIndex: number | null;
  toIndex: number | null;
};

const snapshot = (s: ScriptSection) => ({ heading: s.heading, body: s.body });

/**
 * Diff `prev` → `next` section lists.
 *
 * - added: id in next, not in prev
 * - removed: id in prev, not in next
 * - modified: id in both, heading or body changed (index changes ignored)
 * - moved: id in both, identical content, different index
 * Identical lists → []. Output ordered by next-list position (removals last).
 */
export function diffScriptVersions(prev: ScriptSection[], next: ScriptSection[]): ScriptDiff[] {
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const nextById = new Map(next.map((s) => [s.id, s]));
  const prevIndex = new Map(prev.map((s, i) => [s.id, i]));

  const diffs: ScriptDiff[] = [];

  next.forEach((s, toIndex) => {
    const p = prevById.get(s.id);
    if (!p) {
      diffs.push({
        type: "added",
        sectionId: s.id,
        heading: s.heading,
        before: null,
        after: snapshot(s),
        fromIndex: null,
        toIndex,
      });
      return;
    }
    const changed = p.heading !== s.heading || p.body !== s.body;
    const fromIndex = prevIndex.get(s.id) ?? null;
    if (changed) {
      diffs.push({
        type: "modified",
        sectionId: s.id,
        heading: s.heading,
        before: snapshot(p),
        after: snapshot(s),
        fromIndex,
        toIndex,
      });
    } else if (fromIndex !== toIndex) {
      diffs.push({
        type: "moved",
        sectionId: s.id,
        heading: s.heading,
        before: snapshot(p),
        after: snapshot(s),
        fromIndex,
        toIndex,
      });
    }
  });

  prev.forEach((s, fromIndex) => {
    if (!nextById.has(s.id)) {
      diffs.push({
        type: "removed",
        sectionId: s.id,
        heading: s.heading,
        before: snapshot(s),
        after: null,
        fromIndex,
        toIndex: null,
      });
    }
  });

  return diffs;
}
