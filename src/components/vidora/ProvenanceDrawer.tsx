import { useQuery } from "@tanstack/react-query";
import { FileJson } from "lucide-react";
import { provenanceSummary } from "@/lib/provenance";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** P4 provenance drawer — "made with X, licensed Y" per scene + JSON export. */
export function ProvenanceDrawer({
  sceneId,
  open,
  onOpenChange,
}: {
  sceneId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["provenance", sceneId],
    queryFn: async () => {
      if (!sceneId) return [];
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: rows } = await supabase
        .from("asset_provenance")
        .select("*")
        .eq("scene_id", sceneId)
        .order("created_at", { ascending: false });
      return rows ?? [];
    },
    enabled: open && !!sceneId,
  });

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(data ?? [], null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `provenance-${sceneId?.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("provenance")}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {!data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("no_provenance")}</p>
          ) : (
            <>
              {data.map((p) => (
                <div key={p.id} className="rounded-lg border p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    {p.kind}
                  </div>
                  <div className="mt-1 text-sm">
                    {provenanceSummary({ provider: p.provider, model: p.model, license: p.license })}
                  </div>
                  {p.license_url && (
                    <a
                      href={p.license_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline"
                    >
                      {p.license_url}
                    </a>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={downloadJson}>
                <FileJson className="mr-1 h-4 w-4" /> {t("download_provenance")}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
