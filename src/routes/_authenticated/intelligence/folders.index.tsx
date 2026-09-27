import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FolderKanban, Pin, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addRule,
  createFolder,
  deleteFolder,
  FOLDER_ITEM_TYPES,
  getFolderContents,
  listFolders,
  pinItem,
  removeRule,
  RULE_FIELDS,
  RULE_OPERATORS,
  unpinItem,
  updateFolder,
  type FolderItem,
  type FolderItemType,
  type FolderRule,
  type RuleField,
  type RuleOperator,
} from "@/lib/intelligence/folders.functions";

export const Route = createFileRoute("/_authenticated/intelligence/folders/")({
  component: FoldersPage,
});

const FIELD_LABELS: Record<RuleField, string> = {
  "videos.view_count": "Video · views (latest snapshot)",
  "videos.outlier_score": "Video · outlier score (× channel median)",
  "videos.published_at": "Video · published date",
  "video_ideas.status": "Idea · status",
  "research_sources.source_type": "Source · type",
  "channels.subscriber_count": "Channel · subscribers (latest snapshot)",
};

function formatRuleValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === null || value === undefined) return "—";
  return String(value);
}

function parseRuleValue(field: RuleField, operator: RuleOperator, raw: string): unknown {
  const t = raw.trim();
  if (operator === "in") {
    return t
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s));
  }
  if (
    field === "videos.view_count" ||
    field === "videos.outlier_score" ||
    field === "channels.subscriber_count"
  ) {
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  }
  return t;
}

function ItemList({
  items,
  empty,
  action,
}: {
  items: FolderItem[];
  empty: string;
  action?: (item: FolderItem) => React.ReactNode;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={`${item.itemType}:${item.itemId}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{item.itemType}</Badge>
              {item.detail && <span className="truncate">{item.detail}</span>}
            </div>
          </div>
          {action?.(item)}
        </li>
      ))}
    </ul>
  );
}

function RuleList({
  rules,
  onRemove,
  removing,
}: {
  rules: FolderRule[];
  onRemove: (ruleId: string) => void;
  removing: boolean;
}) {
  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No rules yet — this folder only shows pinned items.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rules.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
        >
          <div className="text-sm">
            <span className="font-medium text-foreground">{FIELD_LABELS[r.field]}</span>{" "}
            <Badge variant="secondary">{r.operator}</Badge>{" "}
            <span className="text-muted-foreground">{formatRuleValue(r.value)}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(r.id)}
            disabled={removing}
            aria-label="Remove rule"
          >
            <X className="size-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function FoldersPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Rule builder state
  const [ruleField, setRuleField] = useState<RuleField>("videos.outlier_score");
  const [ruleOperator, setRuleOperator] = useState<RuleOperator>("gte");
  const [ruleValue, setRuleValue] = useState("2");

  // Pin form state
  const [pinType, setPinType] = useState<FolderItemType>("videos");
  const [pinId, setPinId] = useState("");

  const listFoldersFn = useServerFn(listFolders);
  const createFolderFn = useServerFn(createFolder);
  const updateFolderFn = useServerFn(updateFolder);
  const deleteFolderFn = useServerFn(deleteFolder);
  const addRuleFn = useServerFn(addRule);
  const removeRuleFn = useServerFn(removeRule);
  const pinItemFn = useServerFn(pinItem);
  const unpinItemFn = useServerFn(unpinItem);
  const getContentsFn = useServerFn(getFolderContents);

  const foldersQuery = useQuery({
    queryKey: ["folders"],
    queryFn: () => listFoldersFn({ data: {} }),
  });
  const folders = foldersQuery.data?.status === "ok" ? foldersQuery.data.folders : [];
  const selected = folders.find((f) => f.id === selectedId) ?? null;

  const contentsQuery = useQuery({
    queryKey: ["folder-contents", selectedId],
    queryFn: () => getContentsFn({ data: { folderId: selectedId! } }),
    enabled: !!selectedId,
  });
  const contents = contentsQuery.data?.status === "ok" ? contentsQuery.data : null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["folders"] });
    queryClient.invalidateQueries({ queryKey: ["folder-contents"] });
    queryClient.invalidateQueries({ queryKey: ["intelligence-folders"] });
  };
  const onError = (label: string) => (e: unknown) =>
    toast.error(e instanceof Error ? e.message : label);

  const createMut = useMutation({
    mutationFn: (d: { name: string; description: string }) => createFolderFn({ data: d }),
    onSuccess: (r) => {
      if (r.status === "ok") {
        toast.success("Folder created");
        setDialog(null);
        setName("");
        setDescription("");
        setSelectedId(r.folder?.id ?? null);
        invalidate();
      }
    },
    onError: onError("Create failed"),
  });
  const updateMut = useMutation({
    mutationFn: (d: { folderId: string; name: string; description: string }) =>
      updateFolderFn({ data: d }),
    onSuccess: (r) => {
      if (r.status === "ok") {
        toast.success("Folder updated");
        setDialog(null);
        invalidate();
      }
    },
    onError: onError("Update failed"),
  });
  const deleteMut = useMutation({
    mutationFn: (folderId: string) => deleteFolderFn({ data: { folderId } }),
    onSuccess: () => {
      toast.success("Folder deleted");
      setSelectedId(null);
      invalidate();
    },
    onError: onError("Delete failed"),
  });
  const addRuleMut = useMutation({
    mutationFn: () =>
      addRuleFn({
        data: {
          folderId: selectedId!,
          field: ruleField,
          operator: ruleOperator,
          value: parseRuleValue(ruleField, ruleOperator, ruleValue),
        },
      }),
    onSuccess: (r) => {
      if (r.status === "ok") {
        toast.success("Rule added");
        invalidate();
      }
    },
    onError: onError("Add rule failed"),
  });
  const removeRuleMut = useMutation({
    mutationFn: (ruleId: string) => removeRuleFn({ data: { ruleId } }),
    onSuccess: () => {
      toast.success("Rule removed");
      invalidate();
    },
    onError: onError("Remove failed"),
  });
  const pinMut = useMutation({
    mutationFn: () =>
      pinItemFn({
        data: { folderId: selectedId!, itemType: pinType, itemId: pinId.trim() },
      }),
    onSuccess: (r) => {
      if (r.status === "ok") {
        toast.success("Item pinned");
        setPinId("");
        invalidate();
      }
    },
    onError: onError("Pin failed"),
  });
  const unpinMut = useMutation({
    mutationFn: (item: FolderItem) =>
      unpinItemFn({
        data: {
          folderId: selectedId!,
          itemType: item.itemType,
          itemId: item.itemId,
        },
      }),
    onSuccess: () => {
      toast.success("Item unpinned");
      invalidate();
    },
    onError: onError("Unpin failed"),
  });

  const openCreate = () => {
    setName("");
    setDescription("");
    setDialog("create");
  };
  const openEdit = () => {
    if (!selected) return;
    setName(selected.name);
    setDescription(selected.description ?? "");
    setDialog("edit");
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Smart Folders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pin items manually or let rules collect them automatically. Rules are ANDed together;
            pinned items never appear twice.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="size-4" /> New folder
        </Button>
      </div>

      {foldersQuery.isLoading && (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      )}
      {foldersQuery.isError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          Could not load folders. Please retry.
        </div>
      )}

      {!foldersQuery.isLoading && !foldersQuery.isError && (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Folder list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Folders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {folders.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center">
                  <FolderKanban
                    className="mx-auto size-6 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    No folders yet. Create one to start collecting.
                  </p>
                </div>
              )}
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedId(f.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedId === f.id
                      ? "border-accent/60 bg-accent/10"
                      : "border-border hover:border-accent/40"
                  }`}
                >
                  <div className="text-sm font-medium text-foreground">{f.name}</div>
                  <div className="mt-1 flex gap-2">
                    <Badge variant="secondary">{f.itemCount} pinned</Badge>
                    <Badge variant="secondary">{f.ruleCount} rules</Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Detail */}
          <div>
            {!selected && (
              <Card>
                <CardContent className="p-10 text-center text-sm text-muted-foreground">
                  Select a folder to view its rules and contents.
                </CardContent>
              </Card>
            )}
            {selected && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                      <CardTitle>{selected.name}</CardTitle>
                      {selected.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={openEdit}>
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete folder "${selected.name}"? Pinned items and rules are removed.`,
                            )
                          ) {
                            deleteMut.mutate(selected.id);
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </CardHeader>
                </Card>

                {/* Rules */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Rules ({selected.ruleCount})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]">
                      <Select value={ruleField} onValueChange={(v) => setRuleField(v as RuleField)}>
                        <SelectTrigger aria-label="Rule field">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>
                              {FIELD_LABELS[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={ruleOperator}
                        onValueChange={(v) => setRuleOperator(v as RuleOperator)}
                      >
                        <SelectTrigger aria-label="Rule operator">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RULE_OPERATORS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label="Rule value"
                        placeholder={ruleOperator === "in" ? "comma-separated values" : "value"}
                        value={ruleValue}
                        onChange={(e) => setRuleValue(e.target.value)}
                      />
                      <Button
                        onClick={() => addRuleMut.mutate()}
                        disabled={addRuleMut.isPending || !ruleValue.trim()}
                      >
                        Add rule
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Dates accept ISO format (e.g. 2026-08-01). Outlier score is latest views ÷
                      channel median views.
                    </p>
                    {contentsQuery.isLoading ? (
                      <Skeleton className="h-10" />
                    ) : (
                      <RuleList
                        rules={contents?.rules ?? []}
                        onRemove={(id) => removeRuleMut.mutate(id)}
                        removing={removeRuleMut.isPending}
                      />
                    )}
                  </CardContent>
                </Card>

                {/* Contents */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Contents</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {contentsQuery.isLoading && (
                      <>
                        <Skeleton className="h-16" />
                        <Skeleton className="h-16" />
                      </>
                    )}
                    {contentsQuery.isError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
                      >
                        Could not load folder contents.
                      </div>
                    )}
                    {contents && (
                      <>
                        <section>
                          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                            <Pin className="size-4 text-accent" /> Pinned ({contents.pinned.length})
                          </h3>
                          <ItemList
                            items={contents.pinned}
                            empty="Nothing pinned yet."
                            action={(item) => (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => unpinMut.mutate(item)}
                              >
                                <X className="size-4" /> Unpin
                              </Button>
                            )}
                          />
                        </section>
                        <section>
                          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                            <Sparkles className="size-4 text-accent" /> Rule-matched (
                            {contents.ruleMatched.length})
                          </h3>
                          <ItemList
                            items={contents.ruleMatched}
                            empty="No items match the current rules."
                          />
                        </section>
                        <section className="rounded-lg border border-border p-3">
                          <h3 className="mb-2 text-sm font-medium">Pin an item by ID</h3>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Select
                              value={pinType}
                              onValueChange={(v) => setPinType(v as FolderItemType)}
                            >
                              <SelectTrigger aria-label="Item type" className="sm:w-44">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FOLDER_ITEM_TYPES.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              aria-label="Item ID"
                              placeholder="Item UUID"
                              value={pinId}
                              onChange={(e) => setPinId(e.target.value)}
                              className="font-mono"
                            />
                            <Button
                              onClick={() => pinMut.mutate()}
                              disabled={!pinId.trim() || pinMut.isPending}
                            >
                              Pin
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Copy an item ID from its detail page (video, idea, source, or channel)
                            and pin it here.
                          </p>
                        </section>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialog !== null} onOpenChange={() => setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "create" ? "New folder" : "Edit folder"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="e.g. History outliers"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="folder-desc">Description</Label>
              <Input
                id="folder-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || createMut.isPending || updateMut.isPending}
              onClick={() => {
                if (dialog === "create") {
                  createMut.mutate({ name: name.trim(), description });
                } else if (dialog === "edit" && selected) {
                  updateMut.mutate({
                    folderId: selected.id,
                    name: name.trim(),
                    description,
                  });
                }
              }}
            >
              {dialog === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
