/**
 * F18 Stock Media — stock search + selection dialog (Stream D, Phase 3).
 *
 * Searches licensed stock (Pexels → Pixabay) and writes the pick into the
 * scene with per-asset rights tracking (selectStockAsset server fn).
 *
 * States: loading / empty / error / unconfigured ("stock provider not
 * connected") are all rendered honestly. Mock preview assets carry the
 * "MOCK — preview asset, not licensed for use" label and a warning on
 * selection.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Image as ImageIcon, Loader2, Search, TriangleAlert, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getStockProviderStatus,
  searchStock,
  selectStockAsset,
} from "@/lib/creation/stock/stock.functions";
import { licenseSummary, type StockRights } from "@/lib/creation/stock/rights";
import { isMockAsset } from "@/lib/creation/stock/rights";
import type { StockAsset } from "@/lib/providers/stock.server";

type SearchResult = Awaited<ReturnType<typeof searchStock>>;

export function StockPicker({
  open,
  onOpenChange,
  sceneId,
  contentItemId,
  initialQuery,
  onSelected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The scene row receiving asset_url + asset_source. */
  sceneId: string;
  /** Optional content item for the content_assets rights record. */
  contentItemId?: string | undefined;
  /** Pre-fills the search box (e.g. the scene's stock search terms). */
  initialQuery?: string | undefined;
  onSelected?: ((result: { assetUrl: string; rights: StockRights }) => void) | undefined;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [kind, setKind] = useState<"photo" | "video">("video");
  const [includeMock, setIncludeMock] = useState(false);
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const searchFn = useServerFn(searchStock);
  const selectFn = useServerFn(selectStockAsset);
  const statusFn = useServerFn(getStockProviderStatus);

  const runSearch = async () => {
    if (!query.trim()) {
      setError("Enter a search term.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const [res, status] = await Promise.all([
        searchFn({ data: { query: query.trim(), kind, perPage: 12, includeMock } }),
        statusFn(),
      ]);
      setResult(res);
      setSearched(true);
      if (!res.configured && !status.anyConfigured) {
        // The honest unavailable state — no keys, no network calls made.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const selectMutation = useMutation({
    mutationFn: async (asset: StockAsset) => {
      setSelectingId(`${asset.provider}:${asset.asset_id}`);
      try {
        return await selectFn({
          data: {
            sceneId,
            asset: {
              provider: asset.provider,
              asset_id: asset.asset_id,
              kind: asset.kind,
              url: asset.url,
              thumb_url: asset.thumb_url,
              source_url: asset.source_url,
              creator: asset.creator,
              license: asset.license,
              width: asset.width,
              height: asset.height,
              fetched_at: asset.fetched_at,
            },
            contentItemId: contentItemId ?? null,
          },
        });
      } finally {
        setSelectingId(null);
      }
    },
    onSuccess: (res) => {
      if (res.mock) {
        toast.warning(res.mockWarning ?? "Mock preview asset selected — not licensed for use.");
      } else {
        toast.success(`Licensed ${res.rights.provider} asset attached to the scene.`);
      }
      onSelected?.({ assetUrl: res.assetUrl, rights: res.rights });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not attach the asset."),
  });

  const reset = () => {
    setQuery("");
    setSearched(false);
    setResult(null);
    setError(null);
    setIncludeMock(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pick stock footage</DialogTitle>
          <DialogDescription>
            Licensed stock from Pexels and Pixabay. Every pick records its license so renders can
            prove licensed use.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="stock-query">Search</Label>
              <Input
                id="stock-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. drone shot of a coastline"
                maxLength={200}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
            </div>
            <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <TabsList>
                <TabsTrigger value="video" className="gap-1">
                  <Video className="h-3 w-3" /> Video
                </TabsTrigger>
                <TabsTrigger value="photo" className="gap-1">
                  <ImageIcon className="h-3 w-3" /> Photo
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={runSearch} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Search
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="stock-mock"
              checked={includeMock}
              onCheckedChange={(v) => setIncludeMock(v === true)}
            />
            <Label htmlFor="stock-mock" className="text-xs font-normal text-muted-foreground">
              Show mock preview assets (labeled, not licensed for use)
            </Label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {busy && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-video w-full" />
              ))}
            </div>
          )}

          {!busy && searched && result && !result.configured && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                <span className="font-medium">Stock provider not connected.</span> Add a Pexels or
                Pixabay API key in Settings → Providers to search licensed stock. (No search was
                attempted — nothing was fetched.)
              </AlertDescription>
            </Alert>
          )}

          {!busy && searched && result?.configured && result.assets.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No {kind === "video" ? "videos" : "photos"} found for “{query}”. Try another search.
            </p>
          )}

          {!busy && result?.configured && result.assets.length > 0 && (
            <div className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto md:grid-cols-3">
              {result.assets.map((asset) => {
                const mock = isMockAsset(asset);
                const key = `${asset.provider}:${asset.asset_id}`;
                const selecting = selectingId === key;
                return (
                  <div key={key} className="overflow-hidden rounded-lg border">
                    <div className="relative aspect-video bg-muted">
                      {asset.kind === "video" ? (
                        <video
                          src={asset.url.startsWith("mock://") ? undefined : asset.url}
                          poster={
                            asset.thumb_url.startsWith("mock://") ? undefined : asset.thumb_url
                          }
                          className="h-full w-full object-cover"
                          muted
                          preload="metadata"
                          playsInline
                        />
                      ) : (
                        <img
                          src={asset.thumb_url.startsWith("mock://") ? "" : asset.thumb_url}
                          alt={asset.creator}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="absolute left-2 top-2 flex gap-1">
                        <Badge variant={mock ? "destructive" : "secondary"} className="text-[10px]">
                          {mock ? "MOCK" : asset.provider}
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2 p-2">
                      <p className="truncate text-xs text-muted-foreground">
                        {mock
                          ? "MOCK — preview asset, not licensed for use"
                          : licenseSummary({
                              provider: asset.provider,
                              assetId: asset.asset_id,
                              kind: asset.kind,
                              license: asset.license,
                              licenseType: asset.provider === "pexels" ? "pexels" : "pixabay",
                              attributionRequired: false,
                              attributionRecommended: asset.provider === "pexels",
                              assetUrl: asset.url,
                              sourceUrl: asset.source_url,
                              creator: asset.creator,
                              width: asset.width,
                              height: asset.height,
                              fetchedAt: asset.fetched_at,
                            })}
                      </p>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={selecting || selectMutation.isPending}
                        onClick={() => selectMutation.mutate(asset)}
                      >
                        {selecting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        {mock ? "Use preview" : "Select"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
