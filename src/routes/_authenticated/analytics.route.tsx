import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useI18n, type I18nKey } from "@/lib/i18n";
import { LangToggle } from "./research.index";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsLayout,
});

const TABS: { to: "/analytics" | "/analytics/buckets" | "/analytics/retention" | "/analytics/audit" | "/analytics/monetization" | "/analytics/roi"; labelKey: I18nKey; end?: boolean }[] = [
  { to: "/analytics", labelKey: "analytics_tab_overview", end: true },
  { to: "/analytics/buckets", labelKey: "analytics_tab_buckets" },
  { to: "/analytics/retention", labelKey: "analytics_tab_retention" },
  { to: "/analytics/audit", labelKey: "analytics_tab_audit" },
  { to: "/analytics/monetization", labelKey: "analytics_tab_monetization" },
  { to: "/analytics/roi", labelKey: "analytics_tab_roi" },
];

function AnalyticsLayout() {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("analytics_title")}</h1>
          <p className="text-muted-foreground">{t("analytics_subtitle")}</p>
        </div>
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      <nav className="mb-8 flex flex-wrap gap-1 border-b" aria-label="Analytics sections">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            {...(tab.end ? { activeOptions: { exact: true } } : {})}
            activeProps={{ className: "border-primary text-foreground" }}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {t(tab.labelKey)}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
