import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  advanceCampaign,
  getCampaign,
  linkCampaignItem,
  listCampaigns,
  type ContentPackageRow,
} from "@/lib/creation/campaigns/campaigns.functions";
import { CAMPAIGN_TRANSITIONS, type CampaignItem } from "@/lib/creation/campaigns/campaigns";

export const Route = createFileRoute("/_authenticated/create/campaigns")({
  component: Campaigns,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_production: "In production",
  ready: "Ready",
};

function Campaigns() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listCampaigns);
  const getFn = useServerFn(getCampaign);
  const advanceFn = useServerFn(advanceCampaign);
  const linkFn = useServerFn(linkCampaignItem);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkItemId, setLinkItemId] = useState("");
  const [linkType, setLinkType] = useState("script");
  const [linkRefId, setLinkRefId] = useState("");

  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: () => listFn({}) });
  const detail = useQuery({
    queryKey: ["campaign", selectedId],
    queryFn: () => getFn({ data: { campaignId: selectedId! } }),
    enabled: selectedId !== null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    if (selectedId) queryClient.invalidateQueries({ queryKey: ["campaign", selectedId] });
  };

  const advance = useMutation({
    mutationFn: (to: "in_production" | "ready") =>
      advanceFn({ data: { campaignId: selectedId!, to } }),
    onSuccess: () => {
      toast.success("Campaign advanced");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Advance failed"),
  });

  const link = useMutation({
    mutationFn: () =>
      linkFn({
        data: {
          campaignId: selectedId!,
          itemId: linkItemId,
          ref: {
            type: linkType as "script" | "title_variant" | "thumbnail_project" | "project",
            id: linkRefId,
          },
        },
      }),
    onSuccess: () => {
      toast.success("Artifact linked");
      setLinkItemId("");
      setLinkRefId("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Link failed"),
  });

  const campaign = detail.data?.campaign as ContentPackageRow | undefined;
  const items = (campaign?.metadata?.items ?? []) as CampaignItem[];
  const nextStatuses = campaign
    ? (CAMPAIGN_TRANSITIONS[campaign.status as keyof typeof CAMPAIGN_TRANSITIONS] ?? [])
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          One idea → multi-format campaign packages. Create campaigns from the Ideation hub; each
          package item links to a real artifact as it is produced.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">All campaigns</h2>
          {campaigns.isPending && (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}
          {campaigns.isError && (
            <p className="text-sm text-destructive">
              Failed to load:{" "}
              {campaigns.error instanceof Error ? campaigns.error.message : "unknown error"}
            </p>
          )}
          {campaigns.data && campaigns.data.campaigns.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No campaigns yet — fan an idea out from the Ideation hub.
              </CardContent>
            </Card>
          )}
          <div className="space-y-2">
            {(campaigns.data?.campaigns ?? []).map((c: ContentPackageRow) => (
              <Card
                key={c.id}
                className={selectedId === c.id ? "cursor-pointer border-accent" : "cursor-pointer"}
                onClick={() => setSelectedId(c.id)}
              >
                <CardContent className="flex items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.formats.join(" · ")}</p>
                  </div>
                  <Badge variant="outline">{STATUS_LABEL[c.status] ?? c.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          {!selectedId && (
            <Card>
              <CardContent className="flex flex-col items-center py-16 text-center">
                <Package className="mb-3 size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Select a campaign to see its package items.
                </p>
              </CardContent>
            </Card>
          )}
          {detail.isPending && selectedId && <Skeleton className="h-64 w-full" />}
          {campaign && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{campaign.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Formats: {campaign.formats.join(", ")}
                    </p>
                  </div>
                  <Badge>{STATUS_LABEL[campaign.status] ?? campaign.status}</Badge>
                </div>
                {nextStatuses.length > 0 && (
                  <div className="flex gap-2 pt-2">
                    {nextStatuses.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        disabled={advance.isPending}
                        onClick={() => advance.mutate(s as "in_production" | "ready")}
                      >
                        {advance.isPending && <Loader2 className="mr-2 size-3 animate-spin" />}
                        Move to {STATUS_LABEL[s]}
                      </Button>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{item.label}</p>
                      {item.status === "created" ? (
                        <Badge variant="default">
                          <CheckCircle2 className="mr-1 size-3" /> linked
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <Circle className="mr-1 size-3" /> planned
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                    {item.ref && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ref: {item.ref.type} ·{" "}
                        <span className="font-mono">{item.ref.id.slice(0, 8)}</span>
                      </p>
                    )}
                    {item.dependsOn.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Depends on: {item.dependsOn.join(", ")}
                      </p>
                    )}
                  </div>
                ))}
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium">Link an artifact</h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    When a real script, title set, or thumbnail project is produced for this
                    campaign, attach its id here. Refs are never invented.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div>
                      <Label htmlFor="link-item">Item</Label>
                      <Select value={linkItemId} onValueChange={setLinkItemId}>
                        <SelectTrigger id="link-item">
                          <SelectValue placeholder="Item" />
                        </SelectTrigger>
                        <SelectContent>
                          {items
                            .filter((i) => i.status === "planned")
                            .map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="link-type">Type</Label>
                      <Select value={linkType} onValueChange={setLinkType}>
                        <SelectTrigger id="link-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="script">script</SelectItem>
                          <SelectItem value="title_variant">title_variant</SelectItem>
                          <SelectItem value="thumbnail_project">thumbnail_project</SelectItem>
                          <SelectItem value="project">project</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="link-ref">Artifact id (UUID)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="link-ref"
                          value={linkRefId}
                          onChange={(e) => setLinkRefId(e.target.value)}
                          placeholder="paste the real row id"
                          className="font-mono"
                        />
                        <Button
                          disabled={link.isPending || !linkItemId || !linkRefId.trim()}
                          onClick={() => link.mutate()}
                        >
                          {link.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                          Link
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
