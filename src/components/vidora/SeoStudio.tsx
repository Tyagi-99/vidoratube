import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Sparkles, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { formatSEOPack } from "@/lib/seo";
import {
  generateSEOMetadata,
  getSEOMetadata,
  updateSEOMetadata,
} from "@/lib/publish.functions";

/** Copies text to the clipboard, with a legacy fallback. */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function SeoStudio({
  projectId,
  videoTitle,
  scriptSummary,
  primaryKeyword,
  nicheKeywords,
}: {
  projectId: string;
  videoTitle: string;
  scriptSummary: string;
  primaryKeyword: string;
  nicheKeywords: string[];
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const genFn = useServerFn(generateSEOMetadata);
  const getFn = useServerFn(getSEOMetadata);
  const updateFn = useServerFn(updateSEOMetadata);

  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");

  const seo = useQuery({
    queryKey: ["seo", projectId],
    queryFn: () => getFn({ data: { project_id: projectId } }),
  });
  const saved = seo.data?.seo;

  useEffect(() => {
    if (saved) {
      setDescription(saved.description ?? "");
      setTags((saved.tags ?? []).join(", "));
    }
  }, [saved]);

  const generate = useMutation({
    mutationFn: () =>
      genFn({
        data: {
          project_id: projectId,
          video_title: videoTitle,
          script_summary: scriptSummary,
          primary_keyword: primaryKeyword,
          niche_keywords: nicheKeywords,
        },
      }),
    onSuccess: () => {
      toast.success("SEO generated");
      queryClient.invalidateQueries({ queryKey: ["seo", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          project_id: projectId,
          title: saved?.selected_title ?? videoTitle,
          description,
          tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("SEO saved");
      queryClient.invalidateQueries({ queryKey: ["seo", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectTitle = useMutation({
    mutationFn: (title: string) =>
      updateFn({ data: { project_id: projectId, title } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["seo", projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const titles = (saved?.titles ?? []) as { title: string; score: number }[];
  const chapters = (saved?.chapters ?? []) as { time: string; label: string }[];

  const copy = (text: string, label: string) => {
    copyText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Copy failed"),
    );
  };

  const fullPack = saved
    ? formatSEOPack({
        titles,
        selectedTitle: saved.selected_title ?? null,
        description,
        tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
        hashtags: (saved.hashtags ?? []) as string[],
        chapters,
      })
    : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("seo_studio")}</h3>
        <div className="flex gap-2">
          {fullPack && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(fullPack, "SEO pack")}
            >
              <Copy className="h-4 w-4" />
              Copy full pack
            </Button>
          )}
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generate.isPending ? t("generating_seo") : t("generate_seo")}
          </Button>
        </div>
      </div>

      {titles.length > 0 && (
        <div className="space-y-2">
          <Label>{t("suggested_titles")}</Label>
          {titles.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => selectTitle.mutate(item.title)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                saved?.selected_title === item.title
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                {saved?.selected_title === item.title && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
                {item.title}
              </span>
              <Badge variant="secondary" className="shrink-0">{item.score}</Badge>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t("description_label")}</Label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => copy(description, "Description")}
            disabled={!description.trim()}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={8}
          placeholder="Video description…"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t("tags_label")}</Label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => copy(tags, "Tags")}
            disabled={!tags.trim()}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tag1, tag2, tag3"
        />
      </div>

      {chapters.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>YouTube chapters</Label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                copy(
                  chapters.map((c) => `${c.time} ${c.label}`).join("\n"),
                  "Chapters",
                )
              }
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <div className="rounded-lg border px-3 py-2 font-mono text-xs">
            {chapters.map((c, i) => (
              <div key={i} className="flex gap-3 py-0.5">
                <span className="shrink-0 text-primary">{c.time}</span>
                <span className="text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
        Save SEO
      </Button>
    </div>
  );
}
