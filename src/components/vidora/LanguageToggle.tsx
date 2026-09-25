import { useI18n, type Lang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

/** Language switcher: English / हिन्दी, persisted to localStorage. */
export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();

  const toggle = () => {
    const next: Lang = lang === "en" ? "hi" : "en";
    setLang(next);
  };

  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={toggle}
      aria-label={t("language")}
      title={t("language")}
      className={compact ? "size-11" : "gap-1.5"}
    >
      <Languages className="size-4" aria-hidden="true" />
      {!compact && <span className="text-xs font-medium">{lang === "en" ? "हिन्दी" : "EN"}</span>}
    </Button>
  );
}
