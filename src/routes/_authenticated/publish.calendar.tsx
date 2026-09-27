import { createFileRoute } from "@tanstack/react-router";
import { PublishCalendar } from "@/components/vidora/publish/PublishCalendar";

export const Route = createFileRoute("/_authenticated/publish/calendar")({
  component: PublishCalendarRoute,
});

function PublishCalendarRoute() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Content calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Week, month, and pipeline views over scheduled publish jobs.
        </p>
      </div>
      <PublishCalendar />
    </div>
  );
}
