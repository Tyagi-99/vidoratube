/**
 * Phase 6 Stream E (P4) — SurfacePreview: generic surface mocks for
 * thumbnail legibility checks (competitor pattern TI-9, D303).
 *
 * Five size-accurate mock surfaces rendered in Vidora's own design language
 * (generic cards — deliberately NOT YouTube's interface). The point is to
 * catch thumbnails that fail at small display sizes before publishing.
 */
import { SURFACE_SPECS, thumbHeightPx, titleClampChars, type SurfaceSpec } from "./surface-specs";

interface SurfacePreviewProps {
  /** Signed/displayable URL of the thumbnail image under review. */
  imageUrl: string;
  /** Video title shown with the mock (truncated per surface). */
  videoTitle: string;
  /** Channel name shown with the mock. */
  channelName?: string;
}

function clampTitle(title: string, spec: SurfaceSpec): string {
  const max = titleClampChars(spec.thumbWidthPx, spec.layout === "stack" ? 2 : 2);
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function Thumb({ imageUrl, spec }: { imageUrl: string; spec: SurfaceSpec }) {
  return (
    <img
      src={imageUrl}
      alt=""
      className="rounded-md border border-border object-cover"
      style={{ width: spec.thumbWidthPx, height: thumbHeightPx(spec.thumbWidthPx) }}
    />
  );
}

function Meta({
  spec,
  title,
  channelName,
}: {
  spec: SurfaceSpec;
  title: string;
  channelName: string;
}) {
  const small = spec.layout === "stack" || spec.layout === "grid";
  return (
    <div className="min-w-0">
      <p
        className={`${small ? "text-[11px]" : "text-xs"} font-medium leading-snug text-foreground`}
      >
        {clampTitle(title, spec)}
      </p>
      <p className={`${small ? "text-[10px]" : "text-[11px]"} mt-0.5 text-muted-foreground`}>
        {channelName} · 128K views · 2 days ago
      </p>
    </div>
  );
}

function SurfaceMock({
  spec,
  imageUrl,
  videoTitle,
  channelName,
}: Omit<SurfacePreviewProps, "channelName"> & { spec: SurfaceSpec; channelName: string }) {
  const row = spec.layout === "row" || spec.layout === "stack";
  return (
    <figure className="rounded-lg border border-border bg-card p-3">
      <figcaption className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {spec.label} · {spec.thumbWidthPx}px wide
      </figcaption>
      <div className={row ? "flex gap-2" : "space-y-2"}>
        <Thumb imageUrl={imageUrl} spec={spec} />
        {spec.showTitle &&
          (spec.showAvatar ? (
            <div className="flex gap-2">
              <div className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />
              <Meta spec={spec} title={videoTitle} channelName={channelName} />
            </div>
          ) : (
            <Meta spec={spec} title={videoTitle} channelName={channelName} />
          ))}
      </div>
    </figure>
  );
}

export function SurfacePreview({ imageUrl, videoTitle, channelName = "Your channel" }: SurfacePreviewProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Generic surface mocks at real display sizes — a legibility check, not an official YouTube
        render. If text or the focal subject is unreadable at 168px, it will fail in the wild.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {SURFACE_SPECS.map((spec) => (
          <SurfaceMock
            key={spec.id}
            spec={spec}
            imageUrl={imageUrl}
            videoTitle={videoTitle}
            channelName={channelName}
          />
        ))}
      </div>
    </div>
  );
}
