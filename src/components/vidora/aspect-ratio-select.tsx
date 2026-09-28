import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

const ASPECT_LABELS: Record<AspectRatio, string> = {
  "16:9": "16:9 · Landscape",
  "9:16": "9:16 · Vertical",
  "1:1": "1:1 · Square",
};

/** Shared aspect-ratio picker used by every creation flow. */
export function AspectRatioSelect({
  value,
  onValueChange,
  id = "aspect-ratio",
  label = "Aspect ratio",
}: {
  value: AspectRatio;
  onValueChange: (v: AspectRatio) => void;
  id?: string;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onValueChange(v as AspectRatio)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASPECT_RATIOS.map((a) => (
            <SelectItem key={a} value={a}>
              {ASPECT_LABELS[a]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
