import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/**
 * Guards an in-progress browser render against accidental loss:
 * - holds a screen wake lock so the OS doesn't sleep mid-render
 * - prompts on tab close / reload while the render is active
 *
 * Call as `useRenderGuard(rendering)` in every component that runs ffmpeg.wasm.
 */
export function useRenderGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let released = false;

    const acquire = async () => {
      try {
        const nav = navigator as NavigatorWithWakeLock;
        if (nav.wakeLock && !released) sentinel = await nav.wakeLock.request("screen");
      } catch {
        /* wake lock unsupported or denied — the beforeunload guard still applies */
      }
    };
    void acquire();

    // Re-acquire when the tab becomes visible again (locks drop on hide).
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinel && !released) void acquire();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // A render is running — make the browser ask before discarding it.
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (sentinel) void sentinel.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
