import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — Vidora AI" },
      { name: "description", content: "How Vidora handles account data, scripts, and generated videos." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated 11 September 2026</p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <p>
          Vidora is an early-access video studio. We collect the email and name you use to sign up,
          scripts and uploads you send to generate a video, and the MP4s stored in your account.
        </p>
        <p>
          Auth and file storage run on Supabase. Planning, stills, and some voice calls go through
          the providers configured for this project (currently Lovable AI / Gemini, and ElevenLabs
          when that key is set). We do not sell your scripts or videos.
        </p>
        <p>
          You can ask us to delete your account by emailing{" "}
          <a className="text-foreground underline" href="mailto:hello@vidora.ai">
            hello@vidora.ai
          </a>
          . The contact form stores the message you send so we can reply.
        </p>
        <p>
          This page is a plain-language notice for a product in preview, not a substitute for
          counsel. See also <Link to="/terms" className="text-foreground underline">Terms</Link>.
        </p>
      </div>
    </div>
  );
}
