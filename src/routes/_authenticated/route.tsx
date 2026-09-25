import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isAppUser, locationToNext, safeAuthNext } from "@/lib/auth-user";
import { AppChrome } from "@/components/vidora/AppChrome";
import { NpsPrompt } from "@/components/vidora/NpsPrompt";
import { useReferralClaim } from "@/hooks/useReferralClaim";
import { useLanguageProfileSync } from "@/hooks/useLanguageProfileSync";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  pendingComponent: StudioPending,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (data.user?.is_anonymous) {
      await supabase.auth.signOut();
    }
    const user = data.user?.is_anonymous ? null : data.user;
    if (error || !isAppUser(user)) {
      throw redirect({
        to: "/auth",
        search: { next: safeAuthNext(locationToNext(location)) },
      });
    }
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  useReferralClaim();
  useLanguageProfileSync();
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <AppChrome />
      <Outlet />
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[320px] max-w-[calc(100vw-2rem)]">
        <div className="pointer-events-auto">
          <NpsPrompt
            question={t("nps_question")}
            commentPlaceholder={t("nps_comment_placeholder")}
            submitLabel={t("nps_submit")}
            thanksLabel={t("nps_thanks")}
            dismissLabel={t("nps_dismiss")}
            errorLabel={t("nps_error")}
          />
        </div>
      </div>
    </div>
  );
}

function StudioPending() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
