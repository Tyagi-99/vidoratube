import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Image as ImageIcon, Loader2, Star, Trash2, Upload } from "lucide-react";
import {
  BRAND_ASSET_KINDS,
  deleteBrandAssetFn,
  listBrandAssetsFn,
  setDefaultBrandAssetFn,
  uploadBrandAssetFn,
  type BrandAsset,
  type BrandAssetKind,
} from "@/lib/brand/brand-assets.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const KIND_TITLES: Record<BrandAssetKind, string> = {
  logo: "Logos",
  font: "Fonts",
  intro: "Intro clips",
  outro: "Outro clips",
};

const KIND_HINTS: Record<BrandAssetKind, string> = {
  logo: "PNG, JPEG, WebP or SVG, up to 5 MB",
  font: "WOFF, WOFF2, TTF or OTF, up to 5 MB",
  intro: "MP4, WebM or MOV, up to 50 MB",
  outro: "MP4, WebM or MOV, up to 50 MB",
};

function AssetCard({
  asset,
  canEdit,
  onDeleted,
}: {
  asset: BrandAsset;
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const setDefaultFn = useServerFn(setDefaultBrandAssetFn);
  const deleteFn = useServerFn(deleteBrandAssetFn);

  const setDefault = useMutation({
    mutationFn: () =>
      setDefaultFn({ data: { workspaceId: asset.workspace_id, assetId: asset.id } }),
    onSuccess: () => {
      toast.success(`“${asset.name}” is now the default ${asset.kind}`);
      queryClient.invalidateQueries({ queryKey: ["brand-library"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not set default"),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { workspaceId: asset.workspace_id, assetId: asset.id } }),
    onSuccess: () => {
      toast.success("Asset removed");
      onDeleted();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove asset"),
  });

  const isVideo = asset.kind === "intro" || asset.kind === "outro";
  const isFont = asset.kind === "font";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {asset.kind === "logo" && asset.preview_url ? (
          <img src={asset.preview_url} alt={asset.name} className="size-full object-contain" />
        ) : isVideo && asset.preview_url ? (
          <video
            src={asset.preview_url}
            className="size-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {asset.name}
          {asset.is_default && (
            <Badge variant="secondary" className="ml-2">
              <Star className="mr-0.5 size-3" /> default
            </Badge>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {isFont ? asset.content_type : asset.kind}
          {asset.bytes ? ` · ${Math.round(asset.bytes / 1024)} KB` : ""}
        </p>
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-1">
          {!asset.is_default && (
            <Button
              variant="outline"
              size="sm"
              title={`Set “${asset.name}” as the default ${asset.kind}`}
              onClick={() => setDefault.mutate()}
              disabled={setDefault.isPending}
            >
              {setDefault.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              <span className="hidden sm:inline">Set default</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            title={`Remove “${asset.name}”`}
            onClick={() => {
              if (window.confirm(`Remove “${asset.name}” from the brand library?`)) remove.mutate();
            }}
            disabled={remove.isPending}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function KindSection({
  workspaceId,
  kind,
  assets,
  canEdit,
  onChanged,
}: {
  workspaceId: string;
  kind: BrandAssetKind;
  assets: BrandAsset[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const uploadFn = useServerFn(uploadBrandAssetFn);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const buf = await file.arrayBuffer();
      const base64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ""));
      return uploadFn({
        data: {
          workspaceId,
          kind,
          name: name.trim() || file.name.replace(/\.[^.]+$/, ""),
          fileBase64: base64,
          contentType: file.type,
        },
      });
    },
    onSuccess: () => {
      toast.success(`${KIND_TITLES[kind].slice(0, -1)} uploaded`);
      setName("");
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{KIND_TITLES[kind]}</h4>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional name"
              maxLength={120}
              className="h-8 w-40"
            />
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
            >
              {upload.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Upload
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{KIND_HINTS[kind]}</p>
      {assets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No {KIND_TITLES[kind].toLowerCase()} yet.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {assets.map((a) => (
            <AssetCard key={a.id} asset={a} canEdit={canEdit} onDeleted={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Phase 4 Stream E (F39) — workspace brand library. Rendered inside BrandKitEditor. */
export function BrandLibrary({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listBrandAssetsFn);
  const key = ["brand-library", workspaceId];
  const assets = useQuery({ queryKey: key, queryFn: () => listFn({ data: { workspaceId } }) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const all = (assets.data?.assets ?? []) as BrandAsset[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Brand library</CardTitle>
        <CardDescription>
          Extra logos, brand fonts, and intro/outro clips for this workspace. The default of each
          kind is the one renders fall back to; the active brand-kit logo above stays the export
          default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {assets.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading the brand library…</p>
        ) : (
          BRAND_ASSET_KINDS.map((kind) => (
            <KindSection
              key={kind}
              workspaceId={workspaceId}
              kind={kind}
              assets={all.filter((a) => a.kind === kind)}
              canEdit={canEdit}
              onChanged={invalidate}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
