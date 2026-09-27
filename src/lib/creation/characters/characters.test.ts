/**
 * F16 — unit tests (validation) + integration tests (server logic with a
 * fake Supabase client; no network, no DB).
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { StoragePort } from "../storage";
import {
  CHARACTER_CONSISTENCY_DISCLAIMER,
  REFERENCE_IMAGE_ALLOWED_MIME,
  referenceImagePath,
  validateReferenceUpload,
} from "./types";
import {
  bindCharacterToScene,
  createCharacter,
  deleteCharacter,
  listCharacters,
  scenesUsingCharacter,
  updateCharacter,
  uploadReferenceImage,
  type CharacterDb,
} from "./characters.server";

/* ------------------------------------------------------------------ */
/* Fake Supabase client                                                */
/* ------------------------------------------------------------------ */

type Filter = { col: string; val: unknown };
type DbOut = { data: unknown; error: { message: string } | null };
type Responder = (ctx: { table: string; op: string; filters: Filter[]; payload: unknown }) => DbOut;

class FakeQuery {
  filters: Filter[] = [];
  op = "select";
  payload: unknown = undefined;
  constructor(
    private readonly table: string,
    private readonly respond: Responder,
  ) {}
  select(): this {
    return this;
  }
  insert(v: unknown): this {
    this.op = "insert";
    this.payload = v;
    return this;
  }
  update(v: unknown): this {
    this.op = "update";
    this.payload = v;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, val });
    return this;
  }
  order(): this {
    return this;
  }
  async maybeSingle(): Promise<DbOut> {
    return this.respond({
      table: this.table,
      op: this.op,
      filters: this.filters,
      payload: this.payload,
    });
  }
  async single(): Promise<DbOut> {
    return this.respond({
      table: this.table,
      op: this.op,
      filters: this.filters,
      payload: this.payload,
    });
  }
  then(onF: (v: DbOut) => void, onR?: (e: unknown) => void): Promise<void> {
    return Promise.resolve(
      this.respond({
        table: this.table,
        op: this.op,
        filters: this.filters,
        payload: this.payload,
      }),
    ).then(onF, onR);
  }
}

class FakeDb {
  constructor(private readonly respond: Responder) {}
  from(table: string): FakeQuery {
    return new FakeQuery(table, this.respond);
  }
  asDb(): CharacterDb {
    return this as unknown as CharacterDb;
  }
}

const ok = (data: unknown): DbOut => ({ data, error: null });
const dbErr = (message: string): DbOut => ({ data: null, error: { message } });

const UID = "11111111-1111-4111-8111-111111111111";
const CID = "33333333-3333-4333-8333-333333333333";
const SID = "44444444-4444-4444-8444-444444444444";

function makeStorage(fail = false): StoragePort & { uploaded: string[] } {
  const uploaded: string[] = [];
  return {
    uploaded,
    uploadImage: async (path) => {
      if (fail) throw new Error("boom");
      uploaded.push(path);
    },
    signImage: async (path) => `signed:${path}`,
  };
}

/* ------------------------------------------------------------------ */
/* Validation (pure)                                                   */
/* ------------------------------------------------------------------ */

describe("validateReferenceUpload", () => {
  it("accepts jpeg/png/webp within 5 MB", () => {
    for (const mime of REFERENCE_IMAGE_ALLOWED_MIME) {
      expect(validateReferenceUpload({ byteLength: 1024, mimeType: mime })).toBeNull();
    }
    expect(
      validateReferenceUpload({ byteLength: 5 * 1024 * 1024, mimeType: "image/png" }),
    ).toBeNull();
  });
  it("rejects unsupported MIME types, empty files and oversize files", () => {
    expect(validateReferenceUpload({ byteLength: 100, mimeType: "image/gif" })).toContain(
      "Unsupported image type",
    );
    expect(validateReferenceUpload({ byteLength: 0, mimeType: "image/png" })).toContain("empty");
    expect(
      validateReferenceUpload({ byteLength: 6 * 1024 * 1024, mimeType: "image/jpeg" }),
    ).toContain("5 MB");
  });
});

describe("referenceImagePath", () => {
  it("scopes the path under character-refs and strips unsafe chars", () => {
    const p = referenceImagePath(UID, CID, "image/webp");
    expect(p).toBe(`character-refs/${UID}/${CID}/ref.webp`);
    const sanitized = referenceImagePath("a/b", "c/../d", "image/png");
    expect(sanitized).not.toContain("..");
    expect(sanitized.split("/").length).toBe(4); // bucket prefix + 2 ids + filename
  });
});

describe("CHARACTER_CONSISTENCY_DISCLAIMER", () => {
  it("never claims consistency and names the proof-render requirement", () => {
    expect(CHARACTER_CONSISTENCY_DISCLAIMER).toContain("not yet verified");
    expect(CHARACTER_CONSISTENCY_DISCLAIMER).toContain("6-scene proof render");
    expect(CHARACTER_CONSISTENCY_DISCLAIMER.toLowerCase()).not.toContain("consistent character");
  });
});

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

describe("createCharacter", () => {
  it("creates with trimmed name + style notes", async () => {
    const db = new FakeDb((ctx) => {
      if (ctx.table === "characters" && ctx.op === "insert")
        return ok({ id: CID, ...(ctx.payload as object), created_at: "", updated_at: "" });
      return dbErr("unexpected");
    });
    const res = await createCharacter(db.asDb(), {
      userId: UID,
      name: "  Captain Nova  ",
      description: "Space hero",
      styleNotes: { art_style: "cel-shaded" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.name).toBe("Captain Nova");
      expect(res.data.style_notes).toMatchObject({ art_style: "cel-shaded" });
    }
  });

  it("rejects blank names and overlong descriptions", async () => {
    const db = new FakeDb(() => dbErr("must not hit the db"));
    const blank = await createCharacter(db.asDb(), { userId: UID, name: "   " });
    expect(blank).toMatchObject({ ok: false, code: "invalid_input" });
    const long = await createCharacter(db.asDb(), {
      userId: UID,
      name: "X",
      description: "y".repeat(2001),
    });
    expect(long).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("updateCharacter / deleteCharacter", () => {
  it("updates whitelisted fields and rejects empty patches", async () => {
    const db = new FakeDb((ctx) => {
      if (ctx.table === "characters" && ctx.op === "update")
        return ok({ id: CID, ...(ctx.payload as object) });
      return dbErr("unexpected");
    });
    const res = await updateCharacter(db.asDb(), {
      userId: UID,
      characterId: CID,
      patch: { name: "Nova Prime", styleNotes: { palette: "teal/orange" } },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.name).toBe("Nova Prime");
    const empty = await updateCharacter(db.asDb(), { userId: UID, characterId: CID, patch: {} });
    expect(empty).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("deletes by id + user", async () => {
    const db = new FakeDb((ctx) =>
      ctx.table === "characters" && ctx.op === "delete" ? ok({ id: CID }) : dbErr("unexpected"),
    );
    const res = await deleteCharacter(db.asDb(), { userId: UID, characterId: CID });
    expect(res).toEqual({ ok: true, data: { id: CID } });
  });
});

describe("listCharacters", () => {
  it("returns the user's characters", async () => {
    const db = new FakeDb((ctx) =>
      ctx.table === "characters" && ctx.op === "select"
        ? ok([{ id: CID, name: "Nova", user_id: UID }])
        : dbErr("unexpected"),
    );
    const res = await listCharacters(db.asDb(), { userId: UID });
    expect(res).toEqual({ ok: true, data: [{ id: CID, name: "Nova", user_id: UID }] });
  });
});

/* ------------------------------------------------------------------ */
/* Reference image upload                                              */
/* ------------------------------------------------------------------ */

describe("uploadReferenceImage", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  let updatedTo: unknown = null;

  beforeEach(() => {
    updatedTo = null;
  });

  function dbFor(charRow: unknown): FakeDb {
    return new FakeDb((ctx) => {
      if (ctx.table === "characters" && ctx.op === "select") return ok(charRow);
      if (ctx.table === "characters" && ctx.op === "update") {
        updatedTo = ctx.payload;
        return ok(null);
      }
      return dbErr("unexpected");
    });
  }

  it("validates before touching storage, then stores the path on the row", async () => {
    const storage = makeStorage();
    const res = await uploadReferenceImage(dbFor({ id: CID }).asDb(), storage, {
      userId: UID,
      characterId: CID,
      bytes,
      mimeType: "image/jpeg",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.storagePath).toBe(`character-refs/${UID}/${CID}/ref.jpg`);
      expect(storage.uploaded).toEqual([`character-refs/${UID}/${CID}/ref.jpg`]);
      expect(updatedTo).toEqual({ reference_image_url: `character-refs/${UID}/${CID}/ref.jpg` });
    }
  });

  it("rejects bad MIME/size without uploading", async () => {
    const storage = makeStorage();
    const bad = await uploadReferenceImage(dbFor({ id: CID }).asDb(), storage, {
      userId: UID,
      characterId: CID,
      bytes,
      mimeType: "image/gif",
    });
    expect(bad).toMatchObject({ ok: false, code: "invalid_upload" });
    expect(storage.uploaded).toHaveLength(0);
  });

  it("returns not_found for another user's character", async () => {
    const res = await uploadReferenceImage(dbFor(null).asDb(), makeStorage(), {
      userId: UID,
      characterId: CID,
      bytes,
      mimeType: "image/png",
    });
    expect(res).toMatchObject({ ok: false, code: "not_found" });
  });
});

/* ------------------------------------------------------------------ */
/* Scene binding                                                       */
/* ------------------------------------------------------------------ */

describe("bindCharacterToScene", () => {
  const sceneRow = { id: SID, project_id: "p-1", scene_number: 3, metadata: null as null };

  function dbFor(scene: unknown, charRow: unknown): FakeDb {
    return new FakeDb((ctx) => {
      if (ctx.table === "scenes" && ctx.op === "select") return ok(scene);
      if (ctx.table === "characters" && ctx.op === "select") return ok(charRow);
      if (ctx.table === "scenes" && ctx.op === "update") return ok({ ...(ctx.payload as object) });
      return dbErr("unexpected");
    });
  }

  it("writes character_id into scene metadata and carries the disclaimer", async () => {
    const db = new FakeDb((ctx) => {
      if (ctx.table === "scenes" && ctx.op === "select") return ok(sceneRow);
      if (ctx.table === "characters" && ctx.op === "select") return ok({ id: CID });
      if (ctx.table === "scenes" && ctx.op === "update") {
        const meta = (ctx.payload as { metadata: Record<string, unknown> }).metadata;
        expect(meta["character_id"]).toBe(CID);
        return ok(null);
      }
      return dbErr("unexpected");
    });
    const res = await bindCharacterToScene(db.asDb(), {
      userId: UID,
      sceneId: SID,
      characterId: CID,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.characterId).toBe(CID);
      expect(res.data.disclaimer).toContain("not yet verified");
    }
  });

  it("preserves existing metadata keys and supports unbind", async () => {
    let written: unknown = null;
    const db = new FakeDb((ctx) => {
      if (ctx.table === "scenes" && ctx.op === "select")
        return ok({ ...sceneRow, metadata: { keep: "me" } });
      if (ctx.table === "scenes" && ctx.op === "update") {
        written = ctx.payload;
        return ok(null);
      }
      return dbErr("unexpected");
    });
    const res = await bindCharacterToScene(db.asDb(), {
      userId: UID,
      sceneId: SID,
      characterId: null,
    });
    expect(res.ok).toBe(true);
    expect(written).toEqual({ metadata: { keep: "me", character_id: null } });
  });

  it("rejects unknown scenes and foreign characters", async () => {
    const noScene = await bindCharacterToScene(dbFor(null, { id: CID }).asDb(), {
      userId: UID,
      sceneId: SID,
      characterId: CID,
    });
    expect(noScene).toMatchObject({ ok: false, code: "scene_not_found" });
    const noChar = await bindCharacterToScene(dbFor(sceneRow, null).asDb(), {
      userId: UID,
      sceneId: SID,
      characterId: CID,
    });
    expect(noChar).toMatchObject({ ok: false, code: "character_not_found" });
  });
});

describe("scenesUsingCharacter", () => {
  it("filters scenes by metadata.character_id", async () => {
    const db = new FakeDb((ctx) =>
      ctx.table === "scenes" && ctx.op === "select"
        ? ok([
            { id: "s1", project_id: "p1", scene_number: 1, metadata: { character_id: CID } },
            { id: "s2", project_id: "p1", scene_number: 2, metadata: { character_id: "other" } },
            { id: "s3", project_id: "p1", scene_number: 3, metadata: null },
          ])
        : dbErr("unexpected"),
    );
    const res = await scenesUsingCharacter(db.asDb(), { userId: UID, characterId: CID });
    expect(res).toEqual({
      ok: true,
      data: [{ sceneId: "s1", projectId: "p1", sceneNumber: 1 }],
    });
  });
});
