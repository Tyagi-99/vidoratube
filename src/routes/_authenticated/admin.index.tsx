import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { adminOverview } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const fn = useServerFn(adminOverview);
  const { data, isLoading } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => fn({}) });

  const stats = [
    { label: "Users", value: data?.users },
    { label: "Renders", value: data?.jobs },
    { label: "Completed", value: data?.completed },
    { label: "Open messages", value: data?.openMessages },
    { label: "Active plans", value: data?.activePlans },
    { label: "Live integrations", value: data?.liveIntegrations },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything happening across Vidora right now.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="surface-card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {stat.label}
            </p>
            {isLoading ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                {stat.value ?? 0}
              </p>
            )}
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-bold tracking-tight text-foreground">Latest renders</h2>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recentJobs ?? []).map((job) => (
              <tr key={job.id} className="border-t border-border">
                <td className="max-w-[280px] truncate px-4 py-3 text-foreground">{job.title}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">{job.status}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(job.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {!isLoading && (data?.recentJobs ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No renders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
