import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createBrandProfile,
  deleteBrandProfile,
  listBrandProfiles,
  normalizeVocabulary,
  updateBrandProfile,
  type BrandProfileRow,
} from "@/lib/creation/brand/brand.functions";

export const Route = createFileRoute("/_authenticated/create/brand-voices")({
  component: BrandVoices,
});

const EMPTY = {
  name: "",
  tone: "",
  persona: "",
  preferred: "",
  avoid: "",
  doList: "",
  dontList: "",
  sampleText: "",
};

function BrandVoices() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listBrandProfiles);
  const createFn = useServerFn(createBrandProfile);
  const updateFn = useServerFn(updateBrandProfile);
  const deleteFn = useServerFn(deleteBrandProfile);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BrandProfileRow | null>(null);
  const [form, setForm] = useState(EMPTY);

  const profiles = useQuery({ queryKey: ["brand-profiles"], queryFn: () => listFn({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["brand-profiles"] });

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const startEdit = (p: BrandProfileRow) => {
    setEditing(p);
    const vocab = (p.vocabulary ?? {}) as { preferred?: string[]; avoid?: string[] };
    setForm({
      name: p.name,
      tone: p.tone,
      persona: p.persona,
      preferred: (vocab.preferred ?? []).join(", "),
      avoid: (vocab.avoid ?? []).join(", "),
      doList: p.do_list.join("\n"),
      dontList: p.dont_list.join("\n"),
      sampleText: p.sample_text,
    });
    setOpen(true);
  };

  const lines = (s: string) =>
    s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        tone: form.tone.trim(),
        persona: form.persona.trim(),
        vocabulary: normalizeVocabulary({ preferred: form.preferred, avoid: form.avoid }),
        doList: lines(form.doList),
        dontList: lines(form.dontList),
        sampleText: form.sampleText.trim(),
      };
      return editing
        ? updateFn({ data: { id: editing.id, ...payload } })
        : createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(editing ? "Brand voice updated" : "Brand voice created");
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Brand voice deleted");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Brand voices</h1>
          <p className="text-sm text-muted-foreground">
            Writing-voice profiles bound to script generation in Script Studio. Deleting a profile
            unbinds it from linked scripts (they keep working).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startCreate}>
              <Plus className="mr-2 size-4" /> New voice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit brand voice" : "New brand voice"}</DialogTitle>
              <DialogDescription>
                Tone, vocabulary, and guardrails the script generator must follow.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="bv-name">Name</Label>
                <Input
                  id="bv-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Documentary narrator"
                />
              </div>
              <div>
                <Label htmlFor="bv-tone">Tone</Label>
                <Input
                  id="bv-tone"
                  value={form.tone}
                  onChange={(e) => setForm({ ...form, tone: e.target.value })}
                  placeholder="calm, authoritative, wry"
                />
              </div>
              <div>
                <Label htmlFor="bv-persona">Persona</Label>
                <Textarea
                  id="bv-persona"
                  value={form.persona}
                  onChange={(e) => setForm({ ...form, persona: e.target.value })}
                  placeholder="A historian who has seen it all and tells stories by the fire…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bv-preferred">Preferred words (comma-separated)</Label>
                  <Input
                    id="bv-preferred"
                    value={form.preferred}
                    onChange={(e) => setForm({ ...form, preferred: e.target.value })}
                    placeholder="cinematic, punchy"
                  />
                </div>
                <div>
                  <Label htmlFor="bv-avoid">Avoid words (comma-separated)</Label>
                  <Input
                    id="bv-avoid"
                    value={form.avoid}
                    onChange={(e) => setForm({ ...form, avoid: e.target.value })}
                    placeholder="clickbait, literally"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bv-do">Do (one per line)</Label>
                  <Textarea
                    id="bv-do"
                    value={form.doList}
                    onChange={(e) => setForm({ ...form, doList: e.target.value })}
                    placeholder={"Open with a question\nKeep sentences short"}
                  />
                </div>
                <div>
                  <Label htmlFor="bv-dont">Don&apos;t (one per line)</Label>
                  <Textarea
                    id="bv-dont"
                    value={form.dontList}
                    onChange={(e) => setForm({ ...form, dontList: e.target.value })}
                    placeholder={"No exclamation marks\nNo invented quotes"}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="bv-sample">Sample text</Label>
                <Textarea
                  id="bv-sample"
                  value={form.sampleText}
                  onChange={(e) => setForm({ ...form, sampleText: e.target.value })}
                  placeholder="Paste a paragraph that sounds like this voice…"
                />
              </div>
              <Button
                className="w-full"
                disabled={save.isPending || !form.name.trim()}
                onClick={() => save.mutate()}
              >
                {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editing ? "Save changes" : "Create voice"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {profiles.isPending && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}
      {profiles.isError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            Failed to load brand voices:{" "}
            {profiles.error instanceof Error ? profiles.error.message : "unknown error"}
          </CardContent>
        </Card>
      )}
      {profiles.data && profiles.data.profiles.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">No brand voices yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one to keep every script in a consistent voice.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(profiles.data?.profiles ?? []).map((p: BrandProfileRow) => {
          const vocab = (p.vocabulary ?? {}) as { preferred?: string[]; avoid?: string[] };
          return (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  {p.workspace_id && <Badge variant="secondary">workspace</Badge>}
                </div>
                {p.tone && <p className="text-xs text-muted-foreground">{p.tone}</p>}
              </CardHeader>
              <CardContent>
                {p.persona && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{p.persona}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {(vocab.preferred ?? []).slice(0, 4).map((w) => (
                    <Badge key={w} variant="outline" className="text-xs">
                      +{w}
                    </Badge>
                  ))}
                  {(vocab.avoid ?? []).slice(0, 4).map((w) => (
                    <Badge key={w} variant="destructive" className="text-xs">
                      −{w}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                    <Pencil className="mr-2 size-3" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete “${p.name}”? Linked scripts will be unbound.`)) {
                        remove.mutate(p.id);
                      }
                    }}
                  >
                    <Trash2 className="mr-2 size-3" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
