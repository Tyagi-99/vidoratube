import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getBrandKit, updateBrandKit, uploadBrandLogo } from "@/lib/agency/agency.functions";
import { FONT_CHOICES, normalizeHexColor } from "@/lib/agency/agency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BrandKitEditor({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const getFn = useServerFn(getBrandKit);
  const updateFn = useServerFn(updateBrandKit);
  const uploadFn = useServerFn(uploadBrandLogo);
  const fileRef = useRef<HTMLInputElement>(null);

  const [primary, setPrimary] = useState("#F59E0B");
  const [secondary, setSecondary] = useState("#111827");
  const [font, setFont] = useState("Inter");

  const key = ["agency-brandkit", workspaceId];
  const kit = useQuery({ queryKey: key, queryFn: () => getFn({ data: { workspaceId } }) });

  useEffect(() => {
    const k = kit.data?.brandKit as
      | { primary_color: string; secondary_color: string; font_family: string }
      | null
      | undefined;
    if (k) {
      setPrimary(k.primary_color);
      setSecondary(k.secondary_color);
      setFont(k.font_family);
    }
  }, [kit.data]);

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          workspaceId,
          brandKit: {
            logoPath: (kit.data?.brandKit as { logo_path?: string | null } | null)?.logo_path ?? null,
            primaryColor: primary,
            secondaryColor: secondary,
            fontFamily: font,
          },
        },
      }),
    onSuccess: () => {
      toast.success("Brand kit saved — it will be applied to new exports");
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save brand kit"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const buf = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ""),
      );
      return uploadFn({ data: { workspaceId, fileBase64: base64, contentType: file.type as never } });
    },
    onSuccess: () => {
      toast.success("Logo uploaded");
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not upload logo"),
  });

  const primaryOk = normalizeHexColor(primary) !== null;
  const secondaryOk = normalizeHexColor(secondary) !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Brand kit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          {kit.data?.logoUrl ? (
            <img src={kit.data.logoUrl} alt="Brand logo" className="size-16 rounded-lg border border-border object-contain" />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              No logo
            </div>
          )}
          {canEdit && (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > 2 * 1024 * 1024) {
                      toast.error("Logo must be under 2 MB.");
                      return;
                    }
                    upload.mutate(f);
                  }
                  e.target.value = "";
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                {upload.isPending ? "Uploading…" : "Upload logo"}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2 MB.</p>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Primary color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryOk ? primary : "#F59E0B"}
                onChange={(e) => setPrimary(e.target.value)}
                disabled={!canEdit}
                className="size-10 cursor-pointer rounded border border-border bg-transparent"
              />
              <Input value={primary} onChange={(e) => setPrimary(e.target.value)} disabled={!canEdit} maxLength={7} />
            </div>
            {!primaryOk && <p className="text-xs text-destructive">Use a hex color like #F59E0B.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Secondary color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={secondaryOk ? secondary : "#111827"}
                onChange={(e) => setSecondary(e.target.value)}
                disabled={!canEdit}
                className="size-10 cursor-pointer rounded border border-border bg-transparent"
              />
              <Input value={secondary} onChange={(e) => setSecondary(e.target.value)} disabled={!canEdit} maxLength={7} />
            </div>
            {!secondaryOk && <p className="text-xs text-destructive">Use a hex color like #111827.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Font</Label>
            <Select value={font} onValueChange={setFont} disabled={!canEdit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_CHOICES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border p-4">
          <div
            className="flex size-12 items-center justify-center rounded-lg text-lg font-bold text-white"
            style={{ backgroundColor: primaryOk ? primary : "#F59E0B", fontFamily: font }}
          >
            Aa
          </div>
          <div>
            <p className="text-sm font-medium" style={{ fontFamily: font }}>
              Export preview
            </p>
            <p className="text-xs text-muted-foreground">
              Colors and logo are threaded into render job metadata and applied to new exports.
            </p>
          </div>
        </div>

        {canEdit && (
          <Button onClick={() => save.mutate()} disabled={save.isPending || !primaryOk || !secondaryOk}>
            {save.isPending ? "Saving…" : "Save brand kit"}
          </Button>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">Viewers can see the brand kit but cannot edit it.</p>
        )}
      </CardContent>
    </Card>
  );
}
