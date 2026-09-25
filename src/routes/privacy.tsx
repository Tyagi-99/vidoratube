import { createFileRoute, Link } from "@tanstack/react-router";
import { hasGrievanceOfficer, legalConfig } from "@/config/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Vidora AI" },
      {
        name: "description",
        content:
          "How Vidora AI collects, uses, and protects your data: account, content, payments, and YouTube API data.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated 25 September 2026</p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <p>
          Vidora AI ("Vidora", "we") is an AI YouTube studio: research, script, voice, video,
          thumbnail, publishing, and analytics tools for creators. This policy explains what data
          we collect and why. If you do not agree, do not use the service.
        </p>

        <h2 className="text-base font-semibold text-foreground">1. Account data</h2>
        <p>
          When you sign up we collect your email address and the name you provide. Authentication
          and database hosting run on Supabase (Lovable Cloud). We use disposable-email detection
          and abuse signals (IP subnet, device identifier) only to prevent credit fraud; this data
          is never sold or shared for marketing.
        </p>

        <h2 className="text-base font-semibold text-foreground">2. Content you create</h2>
        <p>
          Scripts, project settings, generated images, voiceovers, videos, thumbnails, and
          analytics snapshots you create are stored in your private account. Storage buckets are
          private and scoped to your user id. To generate content we send your prompts and scripts
          to our AI providers: the Lovable AI gateway (script, image, and idea generation) and
          ElevenLabs (voiceover). We do not sell your scripts or videos, and we do not use your
          private content to train models.
        </p>

        <h2 className="text-base font-semibold text-foreground">3. YouTube API data</h2>
        <p>
          If you connect a YouTube channel, we request the minimum scopes needed: read-only access
          for analytics and upload access only when you choose to publish. OAuth tokens are
          encrypted with AES-256-GCM before storage and are never exposed to the browser. We use
          YouTube API Services to fetch your video statistics, upload videos you approve, and set
          thumbnails you approve. We comply with the{" "}
          <a
            className="text-foreground underline"
            href="https://developers.google.com/youtube/terms/api-services-terms-of-service"
            target="_blank"
            rel="noreferrer"
          >
            YouTube API Services Terms of Service
          </a>{" "}
          and{" "}
          <a
            className="text-foreground underline"
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noreferrer"
          >
            YouTube Terms of Service
          </a>
          . You can revoke our access at any time from your Google account settings or from the
          Connections page, which immediately stops all YouTube API use.
        </p>

        <h2 className="text-base font-semibold text-foreground">4. Payments</h2>
        <p>
          Paid plans and credit packs are processed by Stripe (global) and Razorpay (India). We
          never see or store your card numbers — checkout happens on the provider's hosted pages.
          We store only the records needed to credit your account: plan, amount, currency, and
          transaction references from webhook events.
        </p>

        <h2 className="text-base font-semibold text-foreground">5. Referrals and analytics</h2>
        <p>
          If you use a referral link, we record the referral relationship to award credits. We
          collect product analytics (page views, feature usage) without personal identifiers to
          improve the studio. You can opt out of marketing emails from any message.
        </p>

        <h2 className="text-base font-semibold text-foreground">6. Your rights</h2>
        <p>
          You can download your videos at any time, and you can ask us to delete your account and
          personal data by emailing{" "}
          <a className="text-foreground underline" href="mailto:hello@vidora.ai">
            hello@vidora.ai
          </a>
          . Deletion removes your projects, media, and account data; anonymized billing records
          required by law are retained.
        </p>

        <h2 className="text-base font-semibold text-foreground">7. Grievance redressal</h2>
        {/*
          Grievance timelines — FLAG FOR LEGAL REVIEW (not legal advice).
          IT Rules 2021 (Rule 3(2)): Grievance Officer must acknowledge a complaint
          within 24 hours and dispose of it within 15 days of receipt.
          DPDP Act 2023 (s.13) gives every Data Principal the right to grievance
          redressal; the draft DPDP Rules propose Board-facing timelines that may
          layer on top of the IT Rules timelines for intermediaries. Confirm the
          currently applicable statutory timeline with counsel before launch.
        */}
        {hasGrievanceOfficer() ? (
          <p>
            Grievance Officer: {legalConfig.grievanceName},{" "}
            <a
              className="text-foreground underline"
              href={`mailto:${legalConfig.grievanceEmail}`}
            >
              {legalConfig.grievanceEmail}
            </a>
            {legalConfig.grievancePostal ? `, ${legalConfig.grievancePostal}` : ""}. We
            acknowledge grievances within 24 hours and aim to resolve them within 15 days.
          </p>
        ) : (
          <p>
            To raise a privacy grievance, use the{" "}
            <Link to="/contact" className="text-foreground underline">
              contact form
            </Link>{" "}
            with "Grievance" in the subject. We acknowledge grievances within 24 hours and
            aim to resolve them within 15 days.
          </p>
        )}

        <h2 className="text-base font-semibold text-foreground">8. Changes</h2>
        <p>
          We will update this policy as the product changes and show the new "last updated" date
          here. Continued use after a change means you accept it.
        </p>

        <p>
          Questions:{" "}
          <a className="text-foreground underline" href="mailto:hello@vidora.ai">
            hello@vidora.ai
          </a>
          . See also <Link to="/terms" className="text-foreground underline">Terms of Service</Link>.
        </p>
      </div>
    </div>
  );
}
