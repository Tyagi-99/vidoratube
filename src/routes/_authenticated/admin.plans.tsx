import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { adminListPlans, adminSavePlan } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/plans")({
  component: AdminPlansPage,
});

type PlanDraft = {
  id: string;
  name: string;
  price_monthly: number;
  credits: number;
  blurb: string;
  features: string;
  highlighted: boolean;
  active: boolean;
  sort_order: number;
};

function AdminPlansPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListPlans);
  const saveFn = useServerFn(adminSavePlan);

  const plans = useQuery({ queryKey: ["admin", "plans"], queryFn: () => listFn({}) });
  const [drafts, setDrafts] = useState<PlanDraft[]>([]);

  useEffect(() => {
    if (!plans.data) return;
    setDrafts(
      plans.data.map((plan) => ({
        id: plan.id,
        name: plan.name,
        price_monthly: Number(plan.price_monthly),
        credits: plan.credits,
        blurb: plan.blurb ?? "",
        features: ((plan.features ?? []) as string[]).join("\n"),
        highlighted: plan.highlighted,
        active: plan.active,
        sort_order: plan.sort_order,
      })),
    );
  }, [plans.data]);

  const save = useMutation({
    mutationFn: (plan: PlanDraft) =>
      saveFn({
        data: {
          ...plan,
          features: plan.features
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Plan saved");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = (id: string, patch: Partial<PlanDraft>) =>
    setDrafts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  if (plans.isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Pricing</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Prices, credits and feature lists shown on the pricing page.
      </p>

      <div className="mt-6 grid gap-5">
        {drafts.map((plan) => (
          <div key={plan.id} className="surface-card p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={plan.name} onChange={(e) => update(plan.id, { name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Price / month (USD)</Label>
                <Input
                  type="number"
                  value={plan.price_monthly}
                  onChange={(e) => update(plan.id, { price_monthly: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Credits</Label>
                <Input
                  type="number"
                  value={plan.credits}
                  onChange={(e) => update(plan.id, { credits: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={plan.sort_order}
                  onChange={(e) => update(plan.id, { sort_order: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <Label>Short description</Label>
              <Input
                value={plan.blurb}
                maxLength={200}
                onChange={(e) => update(plan.id, { blurb: e.target.value })}
              />
            </div>

            <div className="mt-4 space-y-2">
              <Label>Features (one per line)</Label>
              <Textarea
                value={plan.features}
                className="min-h-[120px]"
                onChange={(e) => update(plan.id, { features: e.target.value })}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Highlighted
                <Switch
                  checked={plan.highlighted}
                  onCheckedChange={(v) => update(plan.id, { highlighted: v })}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Active
                <Switch
                  checked={plan.active}
                  onCheckedChange={(v) => update(plan.id, { active: v })}
                />
              </label>
              <Button onClick={() => save.mutate(plan)} disabled={save.isPending}>
                Save plan
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
