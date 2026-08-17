import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminListJobs, adminDeleteJob } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/jobs")({
  component: AdminJobsPage,
});

function AdminJobsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListJobs);
  const deleteFn = useServerFn(adminDeleteJob);

  const jobs = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => listFn({}) });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Render deleted");
      queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Renders</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every video generated on the platform.</p>

      {jobs.isLoading ? (
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold">Format</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(jobs.data ?? []).map((job) => (
                <tr key={job.id} className="border-t border-border">
                  <td className="max-w-[260px] truncate px-4 py-3 text-foreground">{job.title}</td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">
                    {job.owner}
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{job.format}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{job.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(job.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(job.id)}
                      aria-label={`Delete ${job.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {(jobs.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No renders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
