/**
 * Render-engine selection (pure, tested).
 *
 * The user's chosen engine is honored only when the server worker is
 * actually alive; "server" with an offline worker falls back to the browser
 * engine automatically. "browser" always stays "browser".
 */
export type RenderEngine = "browser" | "server";

/**
 * The effective engine for a render attempt. Extracted from RenderPanel
 * (where it was inline) so the fallback rule is unit-testable and shared.
 */
export function resolveEffectiveEngine(
  selected: RenderEngine,
  workerAvailable: boolean,
): RenderEngine {
  return selected === "server" && !workerAvailable ? "browser" : selected;
}
