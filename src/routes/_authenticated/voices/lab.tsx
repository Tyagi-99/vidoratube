import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { VoiceStudio } from "@/components/vidora/voice/VoiceStudio";

/**
 * Legacy TTS lab — the pre-Voice-Intelligence text→speech panel plus
 * custom voice uploads. Kept for power users; the main Voice Library
 * lives at /voices.
 */
export const Route = createFileRoute("/_authenticated/voices/lab")({
  component: VoicesLabPage,
});

function VoicesLabPage() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6">
      <Link
        to="/voices"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Voice Library
      </Link>
      <VoiceStudio />
    </div>
  );
}
