import { STUDIO_STYLES, type StudioStyleId } from "@/lib/styles";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * P4 style picker — CSS gradient swatches as *style hints*.
 * Explicitly labeled: these are NOT generated previews.
 */
export function StylePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: StudioStyleId) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {STUDIO_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className={cn(
              "rounded-lg border p-2 text-left transition",
              value === s.id
                ? "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-primary/50"
            )}
            aria-pressed={value === s.id}
          >
            <div
              className="h-12 rounded-md"
              style={{ background: s.previewGradient }}
              aria-hidden
            />
            <div className="mt-1.5 text-xs font-medium">
              {lang === "hi" ? s.labelHi : s.label}
            </div>
            <div className="text-[10px] text-muted-foreground">{t("style_hint")}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
