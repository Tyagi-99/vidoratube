import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms — Vidora AI" },
      { name: "description", content: "Terms of use for the Vidora early-access video studio." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Terms</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated 11 September 2026</p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <p>
          Vidora is provided as early access. Features, quality, and uptime will change. Do not
          rely on it as your only copy of a video — download anything you care about.
        </p>
        <p>
          You must have the right to use scripts, footage, and music you upload. Voiceover and
          automatic edit require an approved rights status before a final MP4. Do not upload
          material you do not own or have permission to use.
        </p>
        <p>
          Quick generate produces AI narration and AI stills. We do not warrant that outputs are
          unique, accurate, or safe to monetize on YouTube or elsewhere. You are responsible for
          what you publish.
        </p>
        <p>
          Credits are consumed when a render starts. Checkout is not live; listed prices are what we
          intend to charge later. Free credits may be revoked if they are abused.
        </p>
        <p>
          Questions:{" "}
          <a className="text-foreground underline" href="mailto:hello@vidora.ai">
            hello@vidora.ai
          </a>
          . Privacy: <Link to="/privacy" className="text-foreground underline">Privacy</Link>.
        </p>
      </div>
    </div>
  );
}
