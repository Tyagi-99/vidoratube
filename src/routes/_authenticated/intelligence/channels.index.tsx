/**
 * Stream C — /intelligence/channels
 * Tracked channel explorer: search/filter/sort, plus track-new-channel
 * via YouTube search (Stream A: searchChannels + trackChannel).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listChannels,
  searchChannels,
  trackChannel,
  type ChannelCard,
} from "@/lib/intelligence/channels.functions";
import { listNiches } from "@/lib/intelligence/niches.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  FreshnessLabel,
  InsufficientDataPanel,
  PageSkeleton,
  UnconfiguredPanel,
} from "@/lib/intelligence/ui-states";
import { formatNumber } from "@/lib/intelligence/format";

export const Route = createFileRoute("/_authenticated/intelligence/channels/")({
  component: ChannelsIndex,
});

type SortKey = "subscribers" | "growth" | "recent";

function ChannelsIndex() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listChannels);
  const searchFn = useServerFn(searchChannels);
  const trackFn = useServerFn(trackChannel);
  const nichesFn = useServerFn(listNiches);

  const [filter, setFilter] = useState("");
  const [nicheId, setNicheId] = useState("all");
  const [sort, setSort] = useState<SortKey>("subscribers");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [ytQuery, setYtQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChannelCard[] | null>(null);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "unconfigured" | "error">(
    "idle",
  );
  const [searchReason, setSearchReason] = useState("");

  const nichesQuery = useQuery({
    queryKey: ["intel-niches"],
    queryFn: () => nichesFn({ data: {} }),
  });
  const niches = nichesQuery.data?.status === "ok" ? nichesQuery.data.niches : [];

  const channelsQuery = useQuery({
    queryKey: ["intel-channels", nicheId, sort, order],
    queryFn: () =>
      listFn({
        data: {
          nicheId: nicheId === "all" ? undefined : nicheId,
          sort,
          order,
        },
      }),
  });

  const doSearch = async () => {
    const q = ytQuery.trim();
    if (q.length < 2) return;
    setSearchStatus("loading");
    try {
      const res = await searchFn({ data: { query: q, maxResults: 10 } });
      if (res.status === "ok") {
        setSearchResults(res.channels);
        setSearchStatus("idle");
      } else if (res.status === "unconfigured") {
        setSearchStatus("unconfigured");
        setSearchReason(res.reason);
      } else {
        setSearchStatus("error");
        setSearchReason(res.reason);
      }
    } catch (e) {
      setSearchStatus("error");
      setSearchReason(e instanceof Error ? e.message : "Search failed");
    }
  };

  const track = useMutation({
    mutationFn: (externalChannelId: string) => trackFn({ data: { externalChannelId } }),
    onSuccess: (res) => {
      if (res.status === "ok") {
        toast.success(`Now tracking ${res.channel.title ?? res.channel.handle ?? "channel"}`);
        queryClient.invalidateQueries({ queryKey: ["intel-channels"] });
      } else {
        toast.error(res.reason);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to track channel"),
  });

  const res = channelsQuery.data;
  const channels = res?.status === "ok" ? res.channels : [];
  const visible = channels.filter((c) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (c.title ?? "").toLowerCase().includes(q) || (c.handle ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Channels</h1>
        <p className="text-muted-foreground">
          Tracked channels and their snapshot history. Outlier math reads snapshots, never live API
          values.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Filter tracked channels…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Select value={nicheId} onValueChange={setNicheId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All niches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
            {niches.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="subscribers">Subscribers</SelectItem>
            <SelectItem value="growth">7-day growth</SelectItem>
            <SelectItem value="recent">Recently updated</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setOrder(order === "desc" ? "asc" : "desc")}>
          {order === "desc" ? "↓ Desc" : "↑ Asc"}
        </Button>
      </div>

      {/* Tracked list */}
      {channelsQuery.isLoading ? (
        <PageSkeleton />
      ) : channelsQuery.isError ? (
        <ErrorState
          message={
            channelsQuery.error instanceof Error
              ? channelsQuery.error.message
              : "Failed to load channels"
          }
          onRetry={() => channelsQuery.refetch()}
        />
      ) : res?.status === "unconfigured" ? (
        <UnconfiguredPanel reason={res.reason} />
      ) : res?.status === "insufficient_data" ? (
        <InsufficientDataPanel reason={res.reason} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={channels.length === 0 ? "No channels tracked yet" : "No channels match"}
          description={
            channels.length === 0
              ? "Search YouTube below and track your first channel. Snapshots start accumulating from the moment you track."
              : "Try a different filter or niche."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <Link
              key={c.id}
              to="/intelligence/channels/$channelId"
              params={{ channelId: c.id }}
              data-testid="channel-row"
            >
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="truncate text-base">{c.title ?? c.handle ?? "—"}</CardTitle>
                  <p className="truncate text-xs text-muted-foreground">{c.handle}</p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex gap-4">
                    <span>
                      <span className="font-semibold">{formatNumber(c.subscriberCount)}</span>{" "}
                      <span className="text-muted-foreground">subs</span>
                    </span>
                    <span>
                      <span className="font-semibold">{formatNumber(c.videoCount)}</span>{" "}
                      <span className="text-muted-foreground">videos</span>
                    </span>
                    <span>
                      <span
                        className={
                          c.growth7dPct == null
                            ? "text-muted-foreground"
                            : c.growth7dPct >= 0
                              ? "font-semibold text-emerald-600"
                              : "font-semibold text-red-500"
                        }
                      >
                        {c.growth7dPct == null
                          ? "—"
                          : `${c.growth7dPct >= 0 ? "+" : ""}${c.growth7dPct}%`}
                      </span>{" "}
                      <span className="text-muted-foreground">7d</span>
                    </span>
                  </div>
                  <FreshnessLabel
                    capturedAt={c.freshness.capturedAt}
                    staleAfterHours={c.freshness.staleAfterHours}
                  />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Track a new channel */}
      <div className="mt-10">
        <h2 className="mb-1 text-lg font-semibold">Track a new channel</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Search YouTube and add a channel to your tracked set.
        </p>
        <div className="mb-4 flex max-w-lg gap-2">
          <Input
            placeholder="Search YouTube channels…"
            value={ytQuery}
            onChange={(e) => setYtQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSearch();
            }}
          />
          <Button onClick={() => void doSearch()} disabled={searchStatus === "loading"}>
            {searchStatus === "loading" ? "Searching…" : "Search"}
          </Button>
        </div>

        {searchStatus === "unconfigured" ? (
          <UnconfiguredPanel reason={searchReason} />
        ) : searchStatus === "error" ? (
          <ErrorState message={searchReason} onRetry={() => void doSearch()} />
        ) : searchResults != null ? (
          searchResults.length === 0 ? (
            <EmptyState title="No channels found" description="Try a different search term." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {searchResults.map((c) => (
                <Card key={c.externalChannelId}>
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.title ?? "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.handle} · {formatNumber(c.subscriberCount)} subs
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={track.isPending}
                      onClick={() => track.mutate(c.externalChannelId)}
                    >
                      {track.isPending ? "Tracking…" : "Track"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
