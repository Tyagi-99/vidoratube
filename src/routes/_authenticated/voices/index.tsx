import { createFileRoute } from "@tanstack/react-router";
import { VoiceStudio } from "@/components/vidora/voice/VoiceStudio";

export const Route = createFileRoute("/_authenticated/voices/")({
  component: VoicesPage,
});

function VoicesPage() {
  return <VoiceStudio />;
}
