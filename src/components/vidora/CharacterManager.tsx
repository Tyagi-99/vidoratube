import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, User } from "lucide-react";
import { createCharacter, deleteCharacter, listCharacters } from "@/lib/studio-v2.functions";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/** P4 character manager — recurring cast for visual consistency. */
export function CharacterManager({
  selectedId,
  onSelect,
}: {
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listCharacters);
  const createFn = useServerFn(createCharacter);
  const deleteFn = useServerFn(deleteCharacter);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showForm, setShowForm] = useState(false);

  const { data: characters = [], isLoading } = useQuery({
    queryKey: ["characters"],
    queryFn: () => listFn(),
  });

  const create = useMutation({
    mutationFn: (input: { name: string; description: string }) => createFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      setName("");
      setDescription("");
      setShowForm(false);
      toast.success(t("character_created"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      toast.success(t("character_deleted"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">…</div>
      ) : characters.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground">{t("no_characters")}</p>
      ) : (
        <div className="space-y-2">
          {characters.map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-2 rounded-lg border p-2 ${selectedId === c.id ? "border-primary" : "border-border"}`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <User className="h-4 w-4" />
              </div>
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => onSelect?.(selectedId === c.id ? null : c.id)}
              >
                <div className="text-sm font-medium">{c.name}</div>
                {c.description && (
                  <div className="line-clamp-1 text-xs text-muted-foreground">{c.description}</div>
                )}
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove.mutate(c.id)}
                aria-label={`Delete ${c.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {showForm ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div>
            <Label>{t("character_name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label>{t("character_description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate({ name: name.trim(), description: description.trim() })}
            >
              {t("new_character")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              ×
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          <Plus className="mr-1 h-4 w-4" /> {t("new_character")}
        </Button>
      )}
    </div>
  );
}
