import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Vidora AI" },
      {
        name: "description",
        content: "Terms of use for Vidora AI: credits, payments, acceptable use, and publishing rules.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated 25 September 2026</p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <p>
          These terms govern your use of Vidora AI ("Vidora", "we"). By creating an account you
          agree to them.
        </p>

        <h2 className="text-base font-semibold text-foreground">1. The service</h2>
        <p>
          Vidora is an AI YouTube studio: niche research, idea generation, scripts, voiceover,
          video rendering, thumbnails, SEO metadata, a monetization safety score, YouTube
          publishing, and analytics. Features, quality, and availability will change as the product
          develops. Do not rely on it as your only copy of a video — download anything you care
          about.
        </p>

        <h2 className="text-base font-semibold text-foreground">2. Credits and payments</h2>
        <p>
          AI generations, renders, and reviews consume credits. New accounts receive 10 free
          credits after email verification; free credits may be revoked if abused. Paid plans and
          credit packs are billed through Stripe (global) or Razorpay (India) in test mode until
          launch — no real charges are made before we announce live billing. Credits are consumed
          when a generation or render starts and are non-refundable except where required by law
          or where a failed job did not deliver; billing disputes go to{" "}
          <a className="text-foreground underline" href="mailto:hello@vidora.ai">
            hello@vidora.ai
          </a>
          .
        </p>

        <h2 className="text-base font-semibold text-foreground">3. Your content and rights</h2>
        <p>
          You keep ownership of the scripts you write and the videos you render. You must have the
          right to use any scripts, footage, images, or music you upload. Do not upload material
          you do not own or have permission to use. AI-generated outputs may resemble existing
          works; we do not warrant that outputs are unique, accurate, or free of third-party
          rights.
        </p>

        <h2 className="text-base font-semibold text-foreground">4. Publishing and monetization</h2>
        <p>
          Publishing to YouTube always requires your explicit approval — Vidora never publishes
          without it. The monetization safety score is a risk estimate based on public policy
          signals, not a guarantee: YouTube alone decides whether a video is monetized. You are
          responsible for what you publish, including made-for-kids declarations and any required
          disclosures for synthetic or sponsored content.
        </p>

        <h2 className="text-base font-semibold text-foreground">5. Acceptable use</h2>
        <p>
          Do not use Vidora to generate spam, misinformation, hateful content, or material that
          violates YouTube's policies; to farm credits through fake accounts or referrals; or to
          probe, disrupt, or reverse-engineer the service. We may suspend accounts that abuse
          credits, rate limits, or other users.
        </p>

        <h2 className="text-base font-semibold text-foreground">6. Liability</h2>
        <p>
          Vidora is provided "as is" without warranties. To the maximum extent permitted by law,
          we are not liable for demonetization decisions, lost revenue, or indirect damages
          arising from your use of the service.
        </p>

        <h2 className="text-base font-semibold text-foreground">7. Changes</h2>
        <p>
          We may update these terms and will show the new "last updated" date here. Continued use
          after a change means you accept it.
        </p>

        <p>
          Questions:{" "}
          <a className="text-foreground underline" href="mailto:hello@vidora.ai">
            hello@vidora.ai
          </a>
          . Privacy: <Link to="/privacy" className="text-foreground underline">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
