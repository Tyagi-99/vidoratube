/**
 * F16 — character manager: CRUD + style notes + validated reference-image
 * upload + scene/project binding.
 *
 * HONESTY: binding a character attaches the reference only. The UI must state
 * that visual consistency across scenes is NOT verified — no consistency claim
 * until a real six-scene proof render passes.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImagePlus, Link2, Loader2, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CHARACTER_CONSISTENCY_DISCLAIMER,
  bindCharacterToSceneFn,
  createCharacterFn,
  deleteCharacterFn,
  getCharacterWithViewUrl,
  listCharactersFn,
  scenesUsingCharacterFn,
  unbindCharacterFromSceneFn,
  updateCharacterFn,
  uploadCharacterReference,
} from "@/lib/creation/characters/characters.functions";
import type { CharacterRow } from "@/lib/creation/characters/types";
import { getProject, listProjects } from "@/lib/studio.functions";

const EMPTY_FORM = { name: "", description: "", art_style: "", palette: "", wardrobe: "" };

export function CharacterManager() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listCharactersFn);
  const createFn = useServerFn(createCharacterFn);
  const updateFn = useServerFn(updateCharacterFn);
  const deleteFn = useServerFn(deleteCharacterFn);
  const uploadFn = useServerFn(uploadCharacterReference);
  const viewUrlFn = useServerFn(getCharacterWithViewUrl);
  const bindFn = useServerFn(bindCharacterToSceneFn);
  const unbindFn = useServerFn(unbindCharacterFromSceneFn);
  const usageFn = useServerFn(scenesUsingCharacterFn);
  const listProjectsFn = useServerFn(listProjects);
  const getProjectFn = useServerFn(getProject);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [viewUrls, setViewUrls] = useState<Record<string, string>>({});
  const [bindProjectId, setBindProjectId] = useState("");
  const [bindSceneId, setBindSceneId] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const charsQuery = useQuery({
    queryKey: ["characters"],
    queryFn: () => listFn({ data: {} }),
  });
  // create/update/delete/upload throw on failure, so success data is the ok-branch.
  const characters: CharacterRow[] = useMemo(() => charsQuery.data?.data ?? [], [charsQuery.data]);

  const editing = useMemo(
    () => characters.find((c) => c.id === editingId) ?? null,
    [characters, editingId],
  );

  const projectsQuery = useQuery({
    queryKey: ["studio-projects"],
    queryFn: () => listProjectsFn({}),
  });
  const scenesQuery = useQuery({
    queryKey: ["project-scenes", bindProjectId],
    queryFn: () => getProjectFn({ data: { id: bindProjectId } }),
    enabled: !!bindProjectId,
  });
  const scenes: { id: string; scene_number: number }[] =
    (scenesQuery.data as { scenes?: { id: string; scene_number: number }[] } | undefined)?.scenes ??
    [];

  const usageQuery = useQuery({
    queryKey: ["character-usage", editingId],
    queryFn: () => usageFn({ data: { character_id: editingId as string } }),
    enabled: !!editingId,
  });
  const usage: { sceneId: string; projectId: string; sceneNumber: number }[] =
    usageQuery.data?.data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["characters"] });
    queryClient.invalidateQueries({ queryKey: ["character-usage"] });
  };

  const ensureViewUrl = async (c: CharacterRow) => {
    if (!c.reference_image_url || viewUrls[c.id]) return;
    try {
      const res = await viewUrlFn({ data: { id: c.id } });
      if (res.viewUrl) setViewUrls((p) => ({ ...p, [c.id]: res.viewUrl as string }));
    } catch {
      /* preview unavailable — non-fatal */
    }
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };
  const startEdit = (c: CharacterRow) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      description: c.description,
      art_style: c.style_notes["art_style"] ?? "",
      palette: c.style_notes["palette"] ?? "",
      wardrobe: c.style_notes["wardrobe"] ?? "",
    });
    void ensureViewUrl(c);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description,
        style_notes: {
          art_style: form.art_style,
          palette: form.palette,
          wardrobe: form.wardrobe,
        },
      };
      return editingId
        ? updateFn({ data: { id: editingId, ...payload } })
        : createFn({ data: payload });
    },
    onSuccess: (res) => {
      toast.success(editingId ? "Character updated" : "Character created");
      setEditingId(res.data.id);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (res) => {
      toast.success("Character deleted");
      if (editingId === res.data.id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = useMutation({
    mutationFn: async ({ characterId, dataUrl }: { characterId: string; dataUrl: string }) => {
      setUploadingFor(characterId);
      return uploadFn({ data: { id: characterId, image_data_url: dataUrl } });
    },
    onSuccess: (res) => {
      setUploadingFor(null);
      toast.success("Reference image uploaded");
      refresh();
      if (editing) void ensureViewUrl({ ...editing, reference_image_url: res.data.storagePath });
    },
    onError: (e: Error) => {
      setUploadingFor(null);
      toast.error(e.message);
    },
  });

  const bind = useMutation({
    mutationFn: () =>
      bindFn({ data: { scene_id: bindSceneId, character_id: editingId as string } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Character attached to scene");
      setBindSceneId("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unbind = useMutation({
    mutationFn: (sceneId: string) => unbindFn({ data: { scene_id: sceneId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Reference detached");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = editingId;
    if (!file || !target) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      upload.mutate({ characterId: target, dataUrl });
    };
    reader.onerror = () => toast.error("Could not read the file");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const projectList: { id: string; title?: string }[] = Array.isArray(projectsQuery.data)
    ? (projectsQuery.data as { id: string; title?: string }[])
    : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Characters</h3>
          <Button size="sm" variant="outline" onClick={startCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New
          </Button>
        </div>
        {charsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : charsQuery.isError ? (
          <div className="rounded-lg border border-destructive/40 p-3 text-sm">
            Failed to load characters.
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => charsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : characters.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No characters yet. Create one to keep a consistent look across scenes.
          </p>
        ) : (
          characters.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg border p-3 ${c.id === editingId ? "border-primary" : "border-border"}`}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => startEdit(c)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.description || "No description"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {c.reference_image_url && (
                    <span
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      title={CHARACTER_CONSISTENCY_DISCLAIMER}
                    >
                      ref
                    </span>
                  )}
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Editor */}
      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border p-4">
          <h4 className="text-sm font-semibold">
            {editingId ? "Edit character" : "New character"}
          </h4>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Captain Vex"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              maxLength={2000}
              rows={3}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Who is this character? Defining traits, face, build…"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Art style</Label>
              <Input
                value={form.art_style}
                maxLength={300}
                onChange={(e) => setForm((f) => ({ ...f, art_style: e.target.value }))}
                placeholder="Cinematic realism"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color palette</Label>
              <Input
                value={form.palette}
                maxLength={300}
                onChange={(e) => setForm((f) => ({ ...f, palette: e.target.value }))}
                placeholder="Warm tungsten amber"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Wardrobe</Label>
              <Input
                value={form.wardrobe}
                maxLength={300}
                onChange={(e) => setForm((f) => ({ ...f, wardrobe: e.target.value }))}
                placeholder="Black coat, red scarf"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={save.isPending || !form.name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {editingId ? "Save changes" : "Create character"}
            </Button>
            {editingId && (
              <Button
                size="sm"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate(editingId)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </div>
        </div>

        {editingId && (
          <>
            {/* Reference image */}
            <div className="space-y-3 rounded-lg border p-4">
              <h4 className="text-sm font-semibold">Reference image</h4>
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                {CHARACTER_CONSISTENCY_DISCLAIMER}
              </p>
              {editing && editing.reference_image_url && viewUrls[editing.id] && (
                <img
                  src={viewUrls[editing.id]}
                  alt={`${editing.name} reference`}
                  className="max-h-48 rounded-lg border object-cover"
                />
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onFilePicked}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingFor === editingId}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadingFor === editingId ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="mr-1 h-3.5 w-3.5" />
                  )}
                  {uploadingFor === editingId
                    ? "Uploading…"
                    : editing?.reference_image_url
                      ? "Replace reference"
                      : "Upload reference"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  JPEG / PNG / WebP · max 5 MB · stored privately
                </span>
              </div>
            </div>

            {/* Scene binding */}
            <div className="space-y-3 rounded-lg border p-4">
              <h4 className="text-sm font-semibold">Bind to scenes</h4>
              <p className="text-xs text-muted-foreground">
                Attaching a reference lets generation prompts see this character — it does not
                guarantee the render will look like them. {CHARACTER_CONSISTENCY_DISCLAIMER}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Project</Label>
                  <Select
                    value={bindProjectId}
                    onValueChange={(v) => {
                      setBindProjectId(v);
                      setBindSceneId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projectList.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title ?? p.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Scene</Label>
                  <Select
                    value={bindSceneId}
                    onValueChange={setBindSceneId}
                    disabled={!bindProjectId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick scene" />
                    </SelectTrigger>
                    <SelectContent>
                      {scenes.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          Scene {s.scene_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!(editingId && bindProjectId && bindSceneId) || bind.isPending}
                    onClick={() => bind.mutate()}
                  >
                    {bind.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    <Link2 className="mr-1 h-3.5 w-3.5" /> Attach to scene
                  </Button>
                </div>
              </div>

              {usageQuery.isLoading ? (
                <Skeleton className="h-8 w-full" />
              ) : usage.length > 0 ? (
                <div className="space-y-1">
                  <Label>
                    Attached to {usage.length} scene{usage.length === 1 ? "" : "s"}
                  </Label>
                  {usage.map((u) => (
                    <div
                      key={u.sceneId}
                      className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                    >
                      <span>Scene {u.sceneNumber}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={unbind.isPending}
                        onClick={() => unbind.mutate(u.sceneId)}
                      >
                        <Unlink className="mr-1 h-3.5 w-3.5" /> Detach
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Not attached to any scene yet.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
