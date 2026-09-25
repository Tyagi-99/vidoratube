/**
 * Demo reel: the real 60-second homepage demo, rendered through Vidora's
 * assembly pipeline (narration + scene stills + burned-in captions + loudness
 * normalization). Only real renders may appear here — never mockups.
 */
export function DemoReel() {
  const videoObject = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "Vidora AI — 60-second demo",
    description:
      "A real 60-second video rendered with Vidora: AI narration, cinematic scene stills, and burned-in captions, muxed to 1080p MP4.",
    thumbnailUrl: "https://vidoratube.lovable.app/demo/vidora-demo-poster.jpg",
    uploadDate: "2026-09-25",
    duration: "PT1M",
    contentUrl: "https://vidoratube.lovable.app/demo/vidora-demo-60s.mp4",
    embedUrl: "https://vidoratube.lovable.app/",
  };

  return (
    <section className="w-full border-t border-border py-20 sm:py-24">
      <script type="application/ld+json">{JSON.stringify(videoObject)}</script>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 max-w-2xl">
          <p className="font-mono text-xs tracking-[0.2em] text-[oklch(0.82_0.145_78)]">
            PROOF, NOT PROMISES
          </p>
          <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Watch a real render.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Sixty seconds, start to finish: narration, scene stills, burned-in
            captions. Made the same way your videos get made.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-black">
          <video
            className="aspect-video w-full"
            controls
            preload="metadata"
            playsInline
            poster="/demo/vidora-demo-poster.jpg"
          >
            <source src="/demo/vidora-demo-60s.mp4" type="video/mp4" />
            Your browser can't play this video.{" "}
            <a href="/demo/vidora-demo-60s.mp4">Download the MP4</a>.
          </video>
        </div>

        <p className="mt-4 font-mono text-xs text-muted-foreground">
          1080p MP4 · 60 seconds · English narration · captions burned in
        </p>
      </div>
    </section>
  );
}
