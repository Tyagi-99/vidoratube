import { createFileRoute } from "@tanstack/react-router";
import { ReviewStudio } from "@/components/vidora/publish/ReviewStudio";

export const Route = createFileRoute("/_authenticated/publish/review")({
  component: PublishReviewRoute,
});

function PublishReviewRoute() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Review Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Team approval queue — safety scores, server approvals, client sign-off, and publishing
          controls.
        </p>
      </div>
      <ReviewStudio />
    </div>
  );
}
