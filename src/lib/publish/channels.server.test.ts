import { describe, expect, it, beforeEach } from "vitest";
import {
  registerChannelConnection,
  markChannelConnectionRevoked,
  revokeChannelRegistrations,
  listChannelConnections,
  checkChannelHealth,
  computeYouTubeQuotaSummary,
  type ChannelProbes,
} from "./channels.server";

/**
 * Phase 4, Stream A (F27) — registry + health + quota tests.
 * No network: platform probes are injected, and token fixtures use the real
 * AES-256-GCM envelope (encrypt → store → decrypt) so the crypto path is
 * exercised for real.
 */

const USER = "user-1";
const YT_KEY = Buffer.from("a".repeat(32)).toString("base64");
const META_KEY = Buffer.from("b".repeat(32)).toString("base64");

/** Minimal in-memory Supabase stand-in for the chains channels.server uses. */
function makeFakeDb(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = v.map((r) => ({ ...r }));
  let seq = 1;

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((r: any) => boolean)[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let gteCol: string | null = null;
    let gteVal: unknown = null;
    let mode: "select" | "update" | "upsert" = "select";
    let patch: any = null;
    let upsertRow: any = null;
    let upsertConflict: string | null = null;

    const query = () => {
      let r = rows.filter((row) => filters.every((f) => f(row)));
      if (gteCol) r = r.filter((row) => row[gteCol!] >= (gteVal as string));
      if (orderCol) {
        r = [...r].sort((a, b) =>
          orderAsc ? (a[orderCol!] < b[orderCol!] ? -1 : 1) : a[orderCol!] > b[orderCol!] ? -1 : 1,
        );
      }
      return r;
    };

    const applyUpsert = () => {
      const cols = (upsertConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const existing = rows.find((r) => cols.every((c) => r[c] === upsertRow[c]));
      if (existing) {
        Object.assign(existing, upsertRow);
        return existing;
      }
      const row = {
        id: `cc-${seq++}`,
        created_at: new Date().toISOString(),
        ...upsertRow,
      };
      rows.push(row);
      return row;
    };

    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      gte: (col: string, val: unknown) => {
        gteCol = col;
        gteVal = val;
        return api;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return api;
      },
      update: (p: any) => {
        mode = "update";
        patch = p;
        return api;
      },
      upsert: (row: any, opts?: { onConflict?: string }) => {
        mode = "upsert";
        upsertRow = row;
        upsertConflict = opts?.onConflict ?? null;
        return api;
      },
      maybeSingle: async () => ({ data: query()[0] ?? null, error: null }),
      single: async () => {
        if (mode === "upsert") return { data: applyUpsert(), error: null };
        if (mode === "update") {
          const m = query();
          for (const r of m) Object.assign(r, patch);
          return m[0]
            ? { data: m[0], error: null }
            : { data: null, error: { message: "no rows" } };
        }
        const m = query();
        return m[0] ? { data: m[0], error: null } : { data: null, error: { message: "no rows" } };
      },
      // Terminal `await builder` (update/delete without .single()).
      then: (resolve: (v: any) => void) => {
        if (mode === "update") {
          const m = query();
          for (const r of m) Object.assign(r, patch);
          resolve({ data: m, error: null });
        } else {
          resolve({ data: query(), error: null });
        }
      },
    };
    return api;
  }

  return { from, tables };
}

const ALL_PROBES: ChannelProbes = {
  probeYouTube: async () => ({ id: "UC-test", title: "Test Channel" }),
  probeMetaPages: async () => ({ pages: [{ id: "page-1", name: "Test Page" }] }),
  probeInstagramLimit: async () => ({ quotaUsage: 3, quotaTotal: 25 }),
  computeYouTubeQuota: async () => ({
    videosInsertUsed: 1,
    videosInsertLimit: 100,
    searchListUsed: 0,
    searchListLimit: 100,
    sharedPoolUnitsUsed: 50,
    sharedPoolUnitsLimit: 10000,
    window: "rolling_24h",
    computedAt: new Date().toISOString(),
  }),
};

beforeEach(() => {
  process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"] = YT_KEY;
  process.env["META_TOKEN_ENCRYPTION_KEY"] = META_KEY;
});

async function ytTokenDb() {
  const { encryptToken } = await import("../youtube.server");
  const db = makeFakeDb({
    youtube_connections: [
      {
        id: "ytc-1",
        user_id: USER,
        access_token: await encryptToken("ya29.fake"),
        refresh_token: await encryptToken("refresh.fake"),
        // Fresh enough that getValidAccessToken returns the stored token
        // without hitting the refresh endpoint (no network in tests).
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
    ],
    channel_connections: [
      {
        id: "cc-yt-1",
        user_id: USER,
        workspace_id: null,
        platform: "youtube",
        external_channel_id: "UC-test",
        display_name: "Test Channel",
        youtube_connection_id: "ytc-1",
        meta_connection_id: null,
        status: "healthy",
        health: {},
        quota: {},
        last_sync_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
  return db;
}

describe("registerChannelConnection", () => {
  it("registers a new channel row", async () => {
    const db = makeFakeDb({});
    const row = await registerChannelConnection(db as any, {
      userId: USER,
      platform: "youtube",
      externalChannelId: "UC-test",
      displayName: "Test Channel",
      youtubeConnectionId: "ytc-1",
    });
    expect(row.platform).toBe("youtube");
    expect(row.status).toBe("healthy");
    expect(db.tables["channel_connections"]).toHaveLength(1);
  });

  it("is idempotent: reconnecting the same channel updates, not duplicates", async () => {
    const db = makeFakeDb({});
    await registerChannelConnection(db as any, {
      userId: USER,
      platform: "facebook",
      externalChannelId: "page-1",
      displayName: "Old Name",
    });
    const row = await registerChannelConnection(db as any, {
      userId: USER,
      platform: "facebook",
      externalChannelId: "page-1",
      displayName: "New Name",
    });
    expect(db.tables["channel_connections"]).toHaveLength(1);
    expect(row.display_name).toBe("New Name");
  });
});

describe("markChannelConnectionRevoked", () => {
  it("marks the row revoked", async () => {
    const db = makeFakeDb({
      channel_connections: [
        {
          id: "cc-1",
          user_id: USER,
          platform: "youtube",
          external_channel_id: "UC-test",
          status: "healthy",
        },
      ],
    });
    await markChannelConnectionRevoked(db as any, {
      userId: USER,
      platform: "youtube",
      externalChannelId: "UC-test",
    });
    expect(db.tables["channel_connections"]![0]!.status).toBe("revoked");
  });
});

describe("revokeChannelRegistrations", () => {
  it("revokes every row for (user, platform), keeps other platforms", async () => {
    const db = makeFakeDb({
      channel_connections: [
        { id: "cc-1", user_id: USER, platform: "youtube", external_channel_id: "UC-a", status: "healthy" },
        { id: "cc-2", user_id: USER, platform: "facebook", external_channel_id: "page-1", status: "healthy" },
        { id: "cc-3", user_id: "other", platform: "youtube", external_channel_id: "UC-b", status: "healthy" },
      ],
    });
    await revokeChannelRegistrations(db as any, USER, "youtube");
    const rows = db.tables["channel_connections"];
    expect(rows!.find((r: any) => r.id === "cc-1")!.status).toBe("revoked");
    expect(rows!.find((r: any) => r.id === "cc-2")!.status).toBe("healthy");
    expect(rows!.find((r: any) => r.id === "cc-3")!.status).toBe("healthy");
  });
});

describe("listChannelConnections", () => {
  it("returns the user's rows", async () => {
    const db = makeFakeDb({
      channel_connections: [
        { id: "cc-1", user_id: USER, platform: "youtube", external_channel_id: "UC-a" },
        { id: "cc-2", user_id: "other", platform: "youtube", external_channel_id: "UC-b" },
      ],
    });
    const rows = await listChannelConnections(db as any, USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("cc-1");
  });
});

describe("checkChannelHealth — YouTube", () => {
  it("marks healthy and persists the D65 quota summary", async () => {
    const db = await ytTokenDb();
    const { connection, quota } = await checkChannelHealth(db as any, USER, "cc-yt-1", ALL_PROBES);
    expect(connection.status).toBe("healthy");
    expect(connection.health["last_check_at"]).toBeTruthy();
    expect(connection.health["last_error"]).toBeNull();
    const q = quota as { videosInsertLimit: number };
    expect(q.videosInsertLimit).toBe(100);
    const stored = db.tables["channel_connections"]![0]!;
    expect(stored.status).toBe("healthy");
    expect((stored.quota as { videosInsertLimit: number }).videosInsertLimit).toBe(100);
  });

  it("marks degraded when the probe reports a different channel", async () => {
    const db = await ytTokenDb();
    const probes: ChannelProbes = {
      ...ALL_PROBES,
      probeYouTube: async () => ({ id: "UC-other", title: "Someone Else" }),
    };
    const { connection } = await checkChannelHealth(db as any, USER, "cc-yt-1", probes);
    expect(connection.status).toBe("degraded");
    expect(connection.health["last_error"]).toMatch(/changed since registration/);
  });

  it("marks expired when the grant is dead (revoked)", async () => {
    const db = await ytTokenDb();
    const probes: ChannelProbes = {
      ...ALL_PROBES,
      probeYouTube: async () => {
        throw new Error("invalid_grant: token revoked");
      },
    };
    const { connection } = await checkChannelHealth(db as any, USER, "cc-yt-1", probes);
    expect(connection.status).toBe("expired");
    expect(connection.health["last_error"]).toMatch(/invalid_grant/);
  });

  it("marks degraded (not expired) on transient platform errors", async () => {
    const db = await ytTokenDb();
    const probes: ChannelProbes = {
      ...ALL_PROBES,
      probeYouTube: async () => {
        throw new Error("HTTP 503: backend error");
      },
    };
    const { connection } = await checkChannelHealth(db as any, USER, "cc-yt-1", probes);
    expect(connection.status).toBe("degraded");
  });

  it("rejects a connection id owned by someone else", async () => {
    const db = await ytTokenDb();
    await expect(checkChannelHealth(db as any, "intruder", "cc-yt-1", ALL_PROBES)).rejects.toThrow(
      "Channel not found",
    );
  });
});

describe("checkChannelHealth — Meta", () => {
  async function metaTokenDb() {
    const { encryptMetaToken } = await import("../meta-publish.server");
    return makeFakeDb({
      meta_connections: [
        {
          id: "mc-1",
          user_id: USER,
          page_id: "page-1",
          access_token: await encryptMetaToken("EAAG.fake"),
        },
      ],
      channel_connections: [
        {
          id: "cc-ig-1",
          user_id: USER,
          workspace_id: null,
          platform: "instagram",
          external_channel_id: "ig-1",
          display_name: "test_ig",
          youtube_connection_id: null,
          meta_connection_id: "mc-1",
          status: "healthy",
          health: {},
          quota: {},
          last_sync_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
  }

  it("stores the runtime IG publishing limit (D70: never hardcoded)", async () => {
    const db = await metaTokenDb();
    const { connection, quota } = await checkChannelHealth(db as any, USER, "cc-ig-1", ALL_PROBES);
    expect(connection.status).toBe("healthy");
    expect(quota).toEqual({ quotaUsage: 3, quotaTotal: 25 });
  });

  it("marks expired when the Page is no longer accessible", async () => {
    const db = await metaTokenDb();
    const probes: ChannelProbes = { ...ALL_PROBES, probeMetaPages: async () => ({ pages: [] }) };
    const { connection } = await checkChannelHealth(db as any, USER, "cc-ig-1", probes);
    expect(connection.status).toBe("expired");
  });
});

describe("computeYouTubeQuotaSummary", () => {
  it("aggregates the three D65 buckets from api_usage", async () => {
    const db = makeFakeDb({
      api_usage: [
        { user_id: USER, provider: "youtube", units: 1, meta: { quota_bucket: "videos.insert" }, created_at: new Date().toISOString() },
        { user_id: USER, provider: "youtube", units: 1, meta: { quota_bucket: "videos.insert" }, created_at: new Date().toISOString() },
        { user_id: USER, provider: "youtube", units: 1, meta: { quota_bucket: "search.list" }, created_at: new Date().toISOString() },
        { user_id: USER, provider: "youtube", units: 50, meta: { quota_bucket: "shared" }, created_at: new Date().toISOString() },
        { user_id: USER, provider: "elevenlabs", units: 10, meta: {}, created_at: new Date().toISOString() },
        { user_id: "other", provider: "youtube", units: 99, meta: { quota_bucket: "shared" }, created_at: new Date().toISOString() },
      ],
    });
    const q = await computeYouTubeQuotaSummary(db as any, USER);
    expect(q.videosInsertUsed).toBe(2);
    expect(q.videosInsertLimit).toBe(100);
    expect(q.searchListUsed).toBe(1);
    expect(q.sharedPoolUnitsUsed).toBe(50);
    expect(q.window).toBe("rolling_24h");
  });
});
