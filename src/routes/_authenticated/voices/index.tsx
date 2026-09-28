import { createFileRoute } from "@tanstack/react-router";
import { VoiceLibraryPage } from "@/components/vidora/voice/VoiceLibraryPage";

export const Route = createFileRoute("/_authenticated/voices/")({
  component: VoicesPage,
});

function VoicesPage() {
  return <VoiceLibraryPage />;
}
