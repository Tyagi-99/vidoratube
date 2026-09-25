import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccount, updateMyProfile } from "@/lib/jobs.functions";
import { getLang, setLang } from "@/lib/i18n";
import { useSession } from "./useSession";

const STORAGE_KEY = "vidora-lang";

/**
 * Two-way language sync for signed-in users:
 * - On first load, if the browser has no stored choice, adopt the profile's
 *   preferred_language (cross-device preference).
 * - Afterwards, language changes are pushed to the profile.
 * localStorage stays the render source of truth (instant, no fetch).
 */
export function useLanguageProfileSync() {
  const { user, loading } = useSession();
  const accountFn = useServerFn(getMyAccount);
  const updateFn = useServerFn(updateMyProfile);
  const initialized = useRef(false);
  const lastSynced = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user || initialized.current) return;
    initialized.current = true;

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    if (stored) {
      lastSynced.current = stored;
      return;
    }
    accountFn()
      .then((account) => {
        const pref = account?.profile?.preferred_language;
        if (pref === "hi" || pref === "en") {
          lastSynced.current = pref; // set first: setLang dispatches synchronously
          setLang(pref);
        }
      })
      .catch(() => {
        // fail open — English default
      });
  }, [user, loading, accountFn]);

  // Push local changes to the profile. The storage event fires on setLang.
  useEffect(() => {
    if (loading || !user || !initialized.current) return;
    const onStorage = () => {
      const lang = getLang();
      if (lastSynced.current === lang) return;
      lastSynced.current = lang;
      updateFn({ data: { preferred_language: lang } }).catch(() => {
        lastSynced.current = null;
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user, loading, updateFn]);
}
