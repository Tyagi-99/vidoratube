import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Youtube, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getYouTubeConnection,
  requestUploadScope,
} from "@/lib/youtube.functions";
import {
  createPublishJob,
  approvePublishJob,
  executePublishJob,
} from "@/lib/publish.functions";
import { listProjects } from "@/lib/studio.functions";
import { track } from "@/lib/analytics";

export const YT_REVOKED_FLAG = "vidora:yt-revoked";

type Privacy = "private" | "unlisted" | "public";

export function PublishDialog({
  jobId,
  jobTitle,
  initialProjectId,
  open,
  onOpenChange,
}: {
  jobId: string;
  jobTitle: string;
  initialProjectId?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getYouTubeConnection);
  const scopeFn = useServerFn(requestUploadScope);
  // P1 fix (2026-09-29 audit): the Studio dialog no longer calls the legacy
  // direct-upload path (publishJobToYouTube, deleted). Publishing now flows
  // through the gated pipeline — create → approve → execute — so the safety
  // gate, the strict evidence gate, and the unforgeable human-approval record
  // all apply, exactly like the Publish page.
  const createFn = useServerFn(createPublishJob);
  const approveFn = useServerFn(approvePublishJob);
  const executeFn = useServerFn(executePublishJob);
  const projectsFn = useServerFn(listProjects);

  const connectionState = useQuery({
    queryKey: ["youtube"],
    queryFn: () => readFn({}),
    enabled: open,
  });
  const connection = connectionState.data?.connection;

  const [privacy, setPrivacy] = useState<Privacy>("private");
  const [madeForKids, setMadeForKids] = useState<boolean | null>(null);
  const [projectId, setProjectId] = useState<string>(initialProjectId ?? "");

  const projectsState = useQuery({
    queryKey: ["studio-projects"],
    queryFn: () => projectsFn({}),
    enabled: open,
  });
  const projects = (projectsState.data ?? []) as { id: string; title: string | null }[];

  const grantScope = useMutation({
    mutationFn: () => scopeFn({}),
    onSuccess: ({ url }) => {
      // Remember which video the user was publishing so the studio can resume
      // after Google redirects back with ?youtube=upload_granted.
      sessionStorage.setItem("vidora:yt-pending-publish", jobId);
      if (projectId) sessionStorage.setItem("vidora:yt-pending-project", projectId);
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: async () => {
      // Step 1: draft publish job in the chosen project.
      const { publishJob } = await createFn({
        data: { project_id: projectId, video_job_id: jobId },
      });
      // Step 2: human approval — the safety gate (< 50 blocks public) and the
      // strict evidence gate run here, server-side. Approving also writes the
      // unforgeable approval record.
      const approved = await approveFn({
        data: {
          publish_job_id: publishJob.id,
          title: jobTitle || "Vidora video",
          privacy,
          madeForKids: madeForKids ?? false,
          tags: [],
        },
      });
      if (approved.safetyWarning) {
        toast.warning("Published with a safety warning", {
          description: approved.safetyWarning,
        });
      }
      // Step 3: execute — re-checks every gate, then uploads.
      return executeFn({ data: { publish_job_id: approved.publishJob.id } });
    },
    onSuccess: (res) => {
      track("publish_succeeded", { job_id: jobId });
      toast.success(`Published to YouTube (${privacy})`, { description: res.url });
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
      onOpenChange(false);
    },
    onError: (e: Error & { code?: string }) => {
      track("publish_failed", { job_id: jobId });
      // TanStack Start may strip custom Error.code during serialization, so
      // detect via the stable message as a fallback.
      const isRevoked =
        e.code === "YOUTUBE_REVOKED" || /connection was revoked/i.test(e.message ?? "");
      const needsScope =
        e.code === "NEEDS_UPLOAD_SCOPE" || /upload permission is missing/i.test(e.message ?? "");
      if (isRevoked) {
        // The server deleted the dead connection row; mark it so the panel
        // shows "Reconnect YouTube" instead of plain "Connect".
        sessionStorage.setItem(YT_REVOKED_FLAG, "1");
        queryClient.invalidateQueries({ queryKey: ["youtube"] });
        toast.error("YouTube connection revoked", {
          description: "Your Google grant was revoked. Reconnect your channel to publish.",
        });
        onOpenChange(false);
        return;
      }
      if (needsScope) {
        // Refresh the connection state so the dialog shows the grant step.
        void connectionState.refetch();
        return;
      }
      toast.error(e.message);
    },
  });

  const needsScope = connectionState.data?.configured && connection && !connection.hasUploadScope;
  const canPublish = connection && connection.hasUploadScope && madeForKids !== null && projectId !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-destructive" />
            Publish to YouTube
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {jobTitle || "Your finished video"}
          </DialogDescription>
        </DialogHeader>

        {connectionState.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your YouTube connection…
          </div>
        ) : !connectionState.data?.configured ? (
          <p className="py-4 text-sm text-muted-foreground">
            YouTube publishing isn&apos;t configured yet — add your Google OAuth keys in Admin →
            Integrations.
          </p>
        ) : !connection ? (
          <p className="py-4 text-sm text-muted-foreground">
            Connect your YouTube channel first, then come back to publish.
          </p>
        ) : needsScope ? (
          <div className="space-y-4 py-2">
            <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">Upload permission needed</p>
                <p className="mt-1 text-muted-foreground">
                  Your channel is connected with read-only access. Granting the upload permission
                  lets Vidora publish this video — Google will ask you to confirm, and you can
                  revoke it anytime at myaccount.google.com.
                </p>
              </div>
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => grantScope.mutate()}
              disabled={grantScope.isPending}
            >
              {grantScope.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Youtube className="h-4 w-4" />
              )}
              Grant upload permission
            </Button>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Project <span className="text-destructive">*</span>
              </Label>
              <Select value={projectId} onValueChange={(v) => setProjectId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose the project to publish under…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title ?? "Untitled project"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Publishing runs the safety and evidence checks for this project before
                uploading.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Visibility</Label>
              <RadioGroup
                value={privacy}
                onValueChange={(v) => setPrivacy(v as Privacy)}
                className="flex gap-2"
              >
                {(["private", "unlisted", "public"] as const).map((p) => (
                  <div key={p} className="flex-1">
                    <RadioGroupItem value={p} id={`privacy-${p}`} className="peer sr-only" />
                    <Label
                      htmlFor={`privacy-${p}`}
                      className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm capitalize transition-colors peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:font-semibold"
                    >
                      {p}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Is this video made for kids? <span className="text-destructive">*</span>
              </Label>
              <RadioGroup
                value={madeForKids === null ? "" : madeForKids ? "yes" : "no"}
                onValueChange={(v) => setMadeForKids(v === "yes")}
                className="flex gap-2"
              >
                <div className="flex-1">
                  <RadioGroupItem value="yes" id="kids-yes" className="peer sr-only" />
                  <Label
                    htmlFor="kids-yes"
                    className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm transition-colors peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:font-semibold"
                  >
                    Yes
                  </Label>
                </div>
                <div className="flex-1">
                  <RadioGroupItem value="no" id="kids-no" className="peer sr-only" />
                  <Label
                    htmlFor="kids-no"
                    className="flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm transition-colors peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:font-semibold"
                  >
                    No
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-xs leading-relaxed text-muted-foreground">
                YouTube requires every upload to declare this (COPPA). Choose “Yes” if the video is
                directed at children under 13 — YouTube will then limit features like comments and
                personalized ads on it.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {canPublish && (
            <Button
              className="gap-2"
              onClick={() => {
                track("publish_started", { job_id: jobId });
                publish.mutate();
              }}
              disabled={publish.isPending}
            >
              {publish.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Youtube className="h-4 w-4" />
              )}
              Publish {privacy}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
