import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  dismissIdea,
  generateIdeas,
  getResearchProject,
  importOutliers,
  listIdeas,
  listOutliers,
  saveIdea,
  useIdea,
} from "@/lib/research.functions";
import { outlierTier } from "@/lib/outliers";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LangToggle } from "./research.index";

export const Route = createFileRoute("/_authenticated/research/$projectId")({
  component: ResearchDetail,
});

type Tab = "niches" | "outliers" | "ideas";

const TIER_COLORS: Record<string, string> = {
  breakout: "bg-purple-500",
  outlier: "bg-blue-500",
  strong: "bg-green-500",
  normal: "bg-gray-400",
  underperforming: "bg-gray-200",
};

function ResearchDetail() {
  const { projectId } = Route.useParams();
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>("niches");

  const getFn = useServerFn(getResearchProject);
  const { data: project, isLoading } = useQuery({
    queryKey: ["research-project", projectId],
    queryFn: () => getFn({ data: { projectId } }),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-4 h-64" />
      </div>
    );
  }
  if (!project) {
    return <div className="mx-auto max-w-5xl px-4 py-8">Not found</div>;
  }

  const niches = Array.isArray(project.niches) ? project.niches : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link to="/research" className="text-sm text-muted-foreground hover:underline">
            ← {t("back_to_research")}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{project.topic}</h1>
        </div>
        <LangToggle lang={lang} setLang={setLang} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="niches">{t("niches")}</TabsTrigger>
          <TabsTrigger value="outliers">{t("outliers")}</TabsTrigger>
          <TabsTrigger value="ideas">{t("ideas")}</TabsTrigger>
        </TabsList>

        <TabsContent value="niches" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {niches.map((n: any, i: number) => (
              <Card key={i}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-lg">
                    {n.name}
                    <SafetyBadge flag={n.advertiser_safety} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{n.description}</p>
                  <p className="text-muted-foreground">
                    <strong>Audience:</strong> {n.audience}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(n.content_pillars ?? []).map((p: string, j: number) => (
                      <Badge key={j} variant="secondary">
                        {p}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-muted-foreground">Competition: {n.competition}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="outliers" className="mt-4">
          <OutlierTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="ideas" className="mt-4">
          <IdeasTab projectId={projectId} niches={niches} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SafetyBadge({ flag }: { flag: string }) {
  const color =
    flag === "safe" ? "bg-green-500" : flag === "caution" ? "bg-yellow-500" : "bg-red-500";
  return <Badge className={color}>{flag}</Badge>;
}

function OutlierTab({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listOutliers);
  const importFn = useServerFn(importOutliers);
  const [videoUrls, setVideoUrls] = useState("");
  const [channelInput, setChannelInput] = useState("");

  const { data: outliers, isLoading } = useQuery({
    queryKey: ["outliers", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });

  const doImport = useMutation({
    mutationFn: () =>
      importFn({
        data: {
          projectId,
          videoUrls: videoUrls.split("\n").map((s) => s.trim()).filter(Boolean),
          channelInput: channelInput.trim() || undefined,
        },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["outliers", projectId] });
      setVideoUrls("");
      setChannelInput("");
      toast.success(`Imported ${r.imported} videos (~${r.quotaUnits} YouTube quota units)`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("import_outliers")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={videoUrls}
            onChange={(e) => setVideoUrls(e.target.value)}
            placeholder={t("video_urls_placeholder")}
            rows={3}
          />
          <Input
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            placeholder={t("channel_placeholder")}
          />
          <Button onClick={() => doImport.mutate()} disabled={doImport.isPending}>
            {doImport.isPending ? t("importing") : t("import")}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : outliers?.length === 0 ? (
        <p className="text-muted-foreground">{t("no_outliers")}</p>
      ) : (
        <div className="space-y-2">
          {outliers?.map((o) => {
            const tier = outlierTier(o.outlier_score);
            return (
              <Card key={o.id}>
                <CardContent className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{o.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {o.channel_title} · {Number(o.view_count).toLocaleString()} views
                    </p>
                  </div>
                  <Badge className={TIER_COLORS[tier]}>
                    {o.outlier_score}x {t("outlier_score")}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IdeasTab({ projectId, niches }: { projectId: string; niches: any[] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listIdeas);
  const genFn = useServerFn(generateIdeas);
  const saveFn = useServerFn(saveIdea);
  const dismissFn = useServerFn(dismissIdea);
  const useFn = useServerFn(useIdea);
  const [nicheName, setNicheName] = useState("");

  const { data: ideas, isLoading } = useQuery({
    queryKey: ["ideas", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ideas", projectId] });

  const generate = useMutation({
    mutationFn: () =>
      genFn({ data: { projectId, nicheName: nicheName || undefined, count: 5 } }),
    onSuccess: () => {
      refresh();
      setNicheName("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Generation failed"),
  });

  const act = (
    fn: (args: { data: { id: string } }) => Promise<unknown>,
    id: string,
    msg: string,
  ) =>
    toast.promise(fn({ data: { id } }).then(refresh), {
      loading: "...",
      success: msg,
      error: (e) => (e instanceof Error ? e.message : "Failed"),
    });

  const useThisIdea = useMutation({
    mutationFn: (id: string) => useFn({ data: { id, mode: "stock" } }),
    onSuccess: (r) => {
      toast.success(t("project_created"));
      navigate({ to: "/projects/$projectId", params: { projectId: r.projectId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex gap-2 py-4">
          <Input
            value={nicheName}
            onChange={(e) => setNicheName(e.target.value)}
            placeholder={niches[0]?.name ?? "Niche focus (optional)"}
            list="niche-options"
          />
          <datalist id="niche-options">
            {niches.map((n: any, i: number) => (
              <option key={i} value={n.name} />
            ))}
          </datalist>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? t("generating") : t("generate_ideas")}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : ideas?.length === 0 ? (
        <p className="text-muted-foreground">{t("no_ideas")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {ideas?.map((idea) => (
            <Card key={idea.id} className={idea.status === "dismissed" ? "opacity-50" : ""}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2 text-base">
                  {idea.title}
                  <SafetyBadge flag={idea.safety_flag} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <strong>{t("hook_label")}:</strong> {idea.hook}
                </p>
                <p className="text-muted-foreground">
                  <strong>{t("angle_label")}:</strong> {idea.angle}
                </p>
                <div className="flex gap-1">
                  <Badge variant="outline">{idea.format}</Badge>
                  <Badge variant="outline">{idea.difficulty}</Badge>
                  <Badge variant="outline">{idea.status}</Badge>
                </div>
                {idea.status !== "used" && idea.status !== "dismissed" && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act(saveFn, idea.id, t("idea_saved"))}
                    >
                      {t("save")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act(dismissFn, idea.id, t("idea_dismissed"))}
                    >
                      {t("dismiss")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => useThisIdea.mutate(idea.id)}
                      disabled={useThisIdea.isPending}
                    >
                      {useThisIdea.isPending ? t("using") : t("use_idea")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
