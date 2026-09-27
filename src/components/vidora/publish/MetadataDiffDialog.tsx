import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Loader2, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getYouTubeMetadataDiff,
  updateYouTubeVideoMetadata,
  type MetadataDiff,
} from "@/lib/publish/metadata.functions";

/**
 * Phase 4, Stream A (D140) — live YouTube metadata overwrite.
 *
 * Step 1: fetch the CURRENT remote title/description and show an exact diff
 * against the proposed values. Step 2: an explicit human confirm checkbox.
 * Step 3: the update sends the remote hash — the server re-reads the remote
 * snapshot and refuses a stale confirm. The overwrite is audit-logged.
 */
export function MetadataDiffDialog({
  videoId,
  publishJobId,
  initialTitle,
  initialDescription,
}: {
  videoId: string;
  /** The approved publish job this overwrite belongs to (approval gate). */
  publishJobId: string;
  initialTitle: string;
  initialDescription: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: initialTitle, description: initialDescription });
  const [diff, setDiff] = useState<MetadataDiff | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const diffFn = useServerFn(getYouTubeMetadataDiff);
  const updateFn = useServerFn(updateYouTubeVideoMetadata);

  const showDiff = useMutation({
    mutationFn: () =>
      diffFn({
        data: { video_id: videoId, title: form.title.trim(), description: form.description.trim() },
      }),
    onSuccess: (data) => {
      setDiff(data);
      setConfirmed(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyUpdate = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          video_id: videoId,
          publish_job_id: publishJobId,
          title: form.title.trim(),
          description: form.description.trim(),
          confirmed: true,
          remote_hash: diff!.remoteHash,
        },
      }),
    onSuccess: (r) => {
      toast.success(r.changed ? "Live metadata updated" : "Already up to date — nothing changed");
      setOpen(false);
      setDiff(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setDiff(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" title="Edit the live title/description on YouTube (test channel only)">
          <PencilLine className="mr-2 h-4 w-4" /> Live metadata
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit live YouTube metadata</DialogTitle>
          <DialogDescription>
            Overwrites the title/description on the live video. The current remote values are
            fetched first — review the exact diff and confirm explicitly.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="md-title">New title</Label>
            <Input
              id="md-title"
              value={form.title}
              maxLength={100}
              onChange={(e) => {
                setForm({ ...form, title: e.target.value });
                setDiff(null);
              }}
            />
          </div>
          <div>
            <Label htmlFor="md-desc">New description</Label>
            <Textarea
              id="md-desc"
              value={form.description}
              maxLength={5000}
              onChange={(e) => {
                setForm({ ...form, description: e.target.value });
                setDiff(null);
              }}
            />
          </div>
        </div>

        {!diff ? (
          <Button onClick={() => showDiff.mutate()} disabled={showDiff.isPending || !form.title.trim()}>
            {showDiff.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Fetch current & show diff
          </Button>
        ) : (
          <div className="space-y-3">
            {diff.changed ? (
              <>
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Title
                  </p>
                  <p className="text-muted-foreground line-through">{diff.remote.title || "—"}</p>
                  <p className="mt-1 flex items-center gap-1 font-medium">
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" /> {diff.proposed.title}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Description
                  </p>
                  <p className="whitespace-pre-wrap text-muted-foreground line-through">
                    {diff.remote.description || "—"}
                  </p>
                  <p className="mt-1 flex items-start gap-1 whitespace-pre-wrap font-medium">
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0" /> {diff.proposed.description || "—"}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                The live metadata already matches — nothing to change.
              </p>
            )}
            {diff.changed && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-500" />
                  I have reviewed the diff above and I explicitly confirm overwriting the live
                  video's title and description.
                </span>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => applyUpdate.mutate()}
            disabled={!diff?.changed || !confirmed || applyUpdate.isPending}
          >
            {applyUpdate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Overwrite live metadata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
