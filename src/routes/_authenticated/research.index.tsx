import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createResearchProject, listResearchProjects } from "@/lib/research.functions";
import { useI18n, type Lang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/research/")({
  component: ResearchIndex,
});

function ResearchIndex() {
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listResearchProjects);
  const createFn = useServerFn(createResearchProject);
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");

  const { data: projects, isLoading } = useQuery({
    queryKey: ["research-projects"],
    queryFn: () => listFn(),
  });

  const create = useMutation({
    mutationFn: (topic: string) => createFn({ data: { topic } }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["research-projects"] });
      setOpen(false);
      setTopic("");
      navigate({ to: "/research/$projectId", params: { projectId: row.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start research"),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("research_title")}</h1>
          <p className="text-muted-foreground">{t("research_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <LangToggle lang={lang} setLang={setLang} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>{t("new_research")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("new_research")}</DialogTitle>
                <DialogDescription>{t("research_subtitle")}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t("topic_placeholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && topic.trim().length >= 3) create.mutate(topic.trim());
                  }}
                />
                <Button
                  onClick={() => create.mutate(topic.trim())}
                  disabled={create.isPending || topic.trim().length < 3}
                >
                  {create.isPending ? t("exploring") : t("explore")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : projects?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("research_subtitle")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects?.map((p) => (
            <Link key={p.id} to="/research/$projectId" params={{ projectId: p.id }}>
              <Card className="transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{p.topic}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {new Date(p.created_at).toLocaleDateString()}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border text-sm">
      {(["en", "hi"] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1.5 ${lang === l ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          {l === "en" ? "EN" : "हिं"}
        </button>
      ))}
    </div>
  );
}
