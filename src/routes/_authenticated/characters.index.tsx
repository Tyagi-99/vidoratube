/**
 * F16 — standalone characters route: full character CRUD, reference-image
 * upload, and scene binding outside the Studio V2 panel.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CharacterManager } from "@/components/vidora/CharacterManager";

export const Route = createFileRoute("/_authenticated/characters/")({
  head: () => ({
    meta: [
      { title: "Characters — Vidora AI" },
      {
        name: "description",
        content: "Define recurring characters with reference images and attach them to scenes.",
      },
    ],
  }),
  component: CharactersPage,
});

function CharactersPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Characters</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Recurring cast for your videos. Reference images help prompts stay on-look — consistency
        across scenes is not yet verified until a six-scene proof render passes.
      </p>
      <div className="mt-6">
        <CharacterManager />
      </div>
    </div>
  );
}
