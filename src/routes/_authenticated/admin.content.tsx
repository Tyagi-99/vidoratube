import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { adminListContent, adminSaveContent } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/content")({
  component: AdminContentPage,
});

type Draft = Record<string, Record<string, string>>;

function AdminContentPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListContent);
  const saveFn = useServerFn(adminSaveContent);

  const content = useQuery({ queryKey: ["admin", "content"], queryFn: () => listFn({}) });
  const [draft, setDraft] = useState<Draft>({});

  useEffect(() => {
    if (!content.data) return;
    const next: Draft = {};
    for (const row of content.data) {
      next[row.key] = { ...((row.value ?? {}) as Record<string, string>) };
    }
    setDraft(next);
  }, [content.data]);

  const save = useMutation({
    mutationFn: (vars: { key: string; value: Record<string, string> }) => saveFn({ data: vars }),
    onSuccess: () => {
      toast.success("Content saved — the site updates instantly.");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (content.isLoading) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Site content</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Edit the copy that appears on the public website.
      </p>

      <div className="mt-6 space-y-5">
        {(content.data ?? []).map((section) => {
          const values = draft[section.key] ?? {};
          return (
            <div key={section.key} className="surface-card p-6">
              <h2 className="text-lg font-semibold text-foreground">{section.label}</h2>
              <div className="mt-4 grid gap-4">
                {Object.entries(values).map(([field, value]) => (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={`${section.key}-${field}`} className="capitalize">
                      {field.replace(/_/g, " ")}
                    </Label>
                    {value.length > 90 ? (
                      <Textarea
                        id={`${section.key}-${field}`}
                        value={value}
                        maxLength={600}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [section.key]: { ...values, [field]: e.target.value },
                          })
                        }
                      />
                    ) : (
                      <Input
                        id={`${section.key}-${field}`}
                        value={value}
                        maxLength={200}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [section.key]: { ...values, [field]: e.target.value },
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
              <Button
                className="mt-5"
                onClick={() => save.mutate({ key: section.key, value: values })}
                disabled={save.isPending}
              >
                Save section
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
