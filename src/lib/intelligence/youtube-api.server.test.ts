/**
 * Stream A — unit tests for youtube-api.server.ts.
 * Deterministic: global fetch is mocked, Supabase is a fake in-memory client.
 * No network access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchChannels,
  fetchVideos,
  parseISO8601Duration,
  searchChannelsByQuery,
  youtubeApiConfigured,
  YOUTUBE_UNCONFIGURED_REASON,
  type DbListResult,
  type DbQuery,
  type DbSingleResult,
} from "./youtube-api.server";

/* ------------------------------------------------------------------ */
/* Fake Supabase admin                                                 */
/* ------------------------------------------------------------------ */

interface CacheRow {
  cache_key: string;
  user_id: string;
  payload: unknown;
  expires_at: string;
}

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
}

type Filter = { col: string; val: unknown };

class FakeQuery implements DbQuery {
  private filters: Filter[] = [];
  private payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
  private mode: "select" | "write" = "select";

  constructor(
    private readonly table: string,
    private readonly admin: FakeAdmin,
  ) {}

  select(): DbQuery {
    return this;
  }
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>): DbQuery {
    this.mode = "write";
    this.payload = values;
    this.admin.recorded.push({ table: this.table, op: "insert", payload: values });
    return this;
  }
  upsert(
    values: Record<string, unknown> | Array<Record<string, unknown>>,
    _options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): DbQuery {
    this.mode = "write";
    this.payload = values;
    this.admin.recorded.push({ table: this.table, op: "upsert", payload: values });
    return this;
  }
  update(values: Record<string, unknown>): DbQuery {
    this.mode = "write";
    this.payload = values;
    this.admin.recorded.push({ table: this.table, op: "update", payload: values });
    return this;
  }
  delete(): DbQuery {
    this.mode = "write";
    this.admin.recorded.push({ table: this.table, op: "delete" });
    return this;
  }
  eq(column: string, value: unknown): DbQuery {
    this.filters.push({ col: column, val: value });
    return this;
  }
  neq(): DbQuery {
    return this;
  }
  in(): DbQuery {
    return this;
  }
  is(): DbQuery {
    return this;
  }
  not(): DbQuery {
    return this;
  }
  gt(): DbQuery {
    return this;
  }
  gte(): DbQuery {
    return this;
  }
  lt(): DbQuery {
    return this;
  }
  lte(): DbQuery {
    return this;
  }
  order(): DbQuery {
    return this;
  }
  limit(): DbQuery {
    return this;
  }
  range(): DbQuery {
    return this;
  }

  async maybeSingle<T>(): Promise<DbSingleResult<T>> {
    if (this.table === "youtube_api_cache") {
      const key = this.filters.find((f) => f.col === "cache_key")?.val;
      const uid = this.filters.find((f) => f.col === "user_id")?.val;
      const row =
        typeof key === "string" && typeof uid === "string" ? this.admin.cache.get(key) : undefined;
      const match = row && row.user_id === uid ? row : null;
      return { data: (match ?? null) as T | null, error: null };
    }
    return { data: null, error: null };
  }

  async single<T>(): Promise<DbSingleResult<T>> {
    return { data: (this.payload ?? null) as T | null, error: null };
  }

  then<TResult>(
    onfulfilled?:
      ((value: DbListResult<unknown>) => TResult | PromiseLike<TResult>) | undefined | null,
  ): PromiseLike<TResult> {
    if (this.mode === "write" && this.table === "youtube_api_cache" && this.payload) {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const r of rows) {
        const key = r["cache_key"];
        if (typeof key === "string") this.admin.cache.set(key, r as unknown as CacheRow);
      }
    }
    const value: DbListResult<unknown> = { data: [], error: null };
    const result = onfulfilled ? onfulfilled(value) : (value as unknown as TResult);
    return Promise.resolve(result);
  }
}

class FakeAdmin {
  cache = new Map<string, CacheRow>();
  recorded: RecordedCall[] = [];
  from(table: string): DbQuery {
    return new FakeQuery(table, this);
  }
}

const asAdmin = (f: FakeAdmin): SupabaseClient<Database> =>
  f as unknown as SupabaseClient<Database>;

const quotaInserts = (admin: FakeAdmin): Array<Record<string, unknown>> =>
  admin.recorded
    .filter((c) => c.table === "api_usage" && c.op === "insert")
    .map((c) => c.payload as Record<string, unknown>);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const USER_ID = "user-1";

const channelsListPayload = {
  items: [
    {
      id: "UC123",
      snippet: {
        title: "Test Channel",
        description: "A channel",
        customUrl: "@testchannel",
        publishedAt: "2020-01-01T00:00:00Z",
        thumbnails: { high: { url: "https://img/h.jpg" } },
      },
      statistics: { subscriberCount: "12345", videoCount: "67", viewCount: "890123" },
    },
  ],
};

const videosListPayload = {
  items: [
    {
      id: "VID1",
      snippet: {
        title: "Test Video",
        description: "Desc",
        channelId: "UC123",
        channelTitle: "Test Channel",
        publishedAt: "2026-09-20T00:00:00Z",
        thumbnails: { medium: { url: "https://img/m.jpg" } },
      },
      statistics: { viewCount: "999", likeCount: "11", commentCount: "2" },
      contentDetails: { duration: "PT1H2M3S" },
    },
  ],
};

const searchPayload = {
  items: [
    {
      id: { channelId: "UC9" },
      snippet: {
        title: "Found Channel",
        description: "d",
        publishedAt: "2021-05-05T00:00:00Z",
        thumbnails: { default: { url: "https://img/d.jpg" } },
      },
    },
  ],
};

const okJson = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200 });

/* ------------------------------------------------------------------ */

const fetchMock = vi.fn();

beforeEach(() => {
  process.env["YOUTUBE_API_KEY"] = "test-key";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["YOUTUBE_API_KEY"];
});

describe("youtubeApiConfigured", () => {
  it("is false without YOUTUBE_API_KEY and true with it", () => {
    delete process.env["YOUTUBE_API_KEY"];
    expect(youtubeApiConfigured()).toBe(false);
    process.env["YOUTUBE_API_KEY"] = "k";
    expect(youtubeApiConfigured()).toBe(true);
  });
});

describe("unconfigured path", () => {
  it("every call returns { status: 'unconfigured' } naming the founder action, without touching the network", async () => {
    delete process.env["YOUTUBE_API_KEY"];
    const admin = new FakeAdmin();
    const a = asAdmin(admin);

    const c = await fetchChannels(a, USER_ID, ["UC123"]);
    const v = await fetchVideos(a, USER_ID, ["VID1"]);
    const s = await searchChannelsByQuery(a, USER_ID, "history");

    for (const r of [c, v, s]) {
      expect(r.status).toBe("unconfigured");
      if (r.status === "unconfigured") {
        expect(r.reason).toBe(YOUTUBE_UNCONFIGURED_REASON);
        expect(r.reason).toContain("YOUTUBE_API_KEY");
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(quotaInserts(admin)).toHaveLength(0);
  });
});

describe("fetchChannels", () => {
  it("serves a fresh cache entry without a live call or quota record", async () => {
    const admin = new FakeAdmin();
    const cachedInfo = [
      {
        externalId: "UC123",
        title: "Cached Channel",
        handle: "@cached",
        description: null,
        thumbnailUrl: null,
        subscriberCount: 500,
        videoCount: 10,
        viewCount: 1000,
        publishedAt: null,
        fetchedAt: "2026-09-28T00:00:00.000Z",
      },
    ];
    admin.cache.set(`yt:v1:${USER_ID}:channels:UC123`, {
      cache_key: `yt:v1:${USER_ID}:channels:UC123`,
      user_id: USER_ID,
      payload: cachedInfo,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const res = await fetchChannels(asAdmin(admin), USER_ID, ["UC123"]);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.cached).toBe(true);
      expect(res.data).toEqual(cachedInfo);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(quotaInserts(admin)).toHaveLength(0);
  });

  it("treats an expired cache entry as a miss: live call, quota record, 24h cache write", async () => {
    const admin = new FakeAdmin();
    admin.cache.set(`yt:v1:${USER_ID}:channels:UC123`, {
      cache_key: `yt:v1:${USER_ID}:channels:UC123`,
      user_id: USER_ID,
      payload: [],
      expires_at: new Date(Date.now() - 1_000).toISOString(), // expired
    });
    fetchMock.mockResolvedValue(okJson(channelsListPayload));

    const res = await fetchChannels(asAdmin(admin), USER_ID, ["UC123"]);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.cached).toBe(false);
      expect(res.data).toHaveLength(1);
      const info = res.data[0];
      expect(info?.externalId).toBe("UC123");
      expect(info?.title).toBe("Test Channel");
      expect(info?.handle).toBe("@testchannel");
      expect(info?.subscriberCount).toBe(12345);
      expect(info?.videoCount).toBe(67);
      expect(info?.viewCount).toBe(890123);
      expect(info?.thumbnailUrl).toBe("https://img/h.jpg");
    }

    // Live call went to channels.list with snippet+statistics.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/youtube/v3/channels");
    expect(url).toContain("part=snippet%2Cstatistics");
    expect(url).toContain("id=UC123");

    // One quota row for channels.list.
    const quota = quotaInserts(admin);
    expect(quota).toHaveLength(1);
    expect(quota[0]?.["operation"]).toBe("channels.list");
    expect(quota[0]?.["user_id"]).toBe(USER_ID);

    // Cache written with ~24h TTL.
    const upserts = admin.recorded.filter(
      (c) => c.table === "youtube_api_cache" && c.op === "upsert",
    );
    expect(upserts).toHaveLength(1);
    const written = upserts[0]?.payload as { cache_key: string; expires_at: string };
    expect(written.cache_key).toBe(`yt:v1:${USER_ID}:channels:UC123`);
    const ttlHours = (Date.parse(written.expires_at) - Date.now()) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(23.9);
    expect(ttlHours).toBeLessThan(24.1);
  });

  it("throws a clear quota-exceeded error on 403 quotaExceeded", async () => {
    const admin = new FakeAdmin();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "The request cannot be completed because you have exceeded your quota.",
            errors: [{ reason: "quotaExceeded", message: "quota" }],
          },
        }),
        { status: 403 },
      ),
    );
    await expect(fetchChannels(asAdmin(admin), USER_ID, ["UC123"])).rejects.toThrow(
      /quota exceeded/i,
    );
  });

  it("throws a clear invalid-key error on 401", async () => {
    const admin = new FakeAdmin();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 401, message: "API key not valid." } }), {
        status: 401,
      }),
    );
    await expect(fetchChannels(asAdmin(admin), USER_ID, ["UC123"])).rejects.toThrow(
      /YOUTUBE_API_KEY/,
    );
  });

  it("throws a clear network error when fetch fails", async () => {
    const admin = new FakeAdmin();
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await expect(fetchChannels(asAdmin(admin), USER_ID, ["UC123"])).rejects.toThrow(
      /network error or timeout/,
    );
  });
});

describe("fetchVideos", () => {
  it("parses statistics + contentDetails duration and records videos.list quota with 6h TTL", async () => {
    const admin = new FakeAdmin();
    fetchMock.mockResolvedValue(okJson(videosListPayload));

    const res = await fetchVideos(asAdmin(admin), USER_ID, ["VID1"]);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.cached).toBe(false);
      const info = res.data[0];
      expect(info?.externalId).toBe("VID1");
      expect(info?.title).toBe("Test Video");
      expect(info?.durationSeconds).toBe(3723); // PT1H2M3S
      expect(info?.viewCount).toBe(999);
      expect(info?.likeCount).toBe(11);
      expect(info?.commentCount).toBe(2);
      expect(info?.channelId).toBe("UC123");
    }
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/youtube/v3/videos");
    expect(url).toContain("part=snippet%2Cstatistics%2CcontentDetails");

    const quota = quotaInserts(admin);
    expect(quota).toHaveLength(1);
    expect(quota[0]?.["operation"]).toBe("videos.list");

    const upserts = admin.recorded.filter(
      (c) => c.table === "youtube_api_cache" && c.op === "upsert",
    );
    const written = upserts[0]?.payload as { expires_at: string };
    const ttlHours = (Date.parse(written.expires_at) - Date.now()) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(5.9);
    expect(ttlHours).toBeLessThan(6.1);
  });
});

describe("searchChannelsByQuery", () => {
  it("calls search.list type=channel, records quota, caches for 1h", async () => {
    const admin = new FakeAdmin();
    fetchMock.mockResolvedValue(okJson(searchPayload));

    const res = await searchChannelsByQuery(asAdmin(admin), USER_ID, "history", 5);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.cached).toBe(false);
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.externalId).toBe("UC9");
      expect(res.data[0]?.title).toBe("Found Channel");
    }
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/youtube/v3/search");
    expect(url).toContain("type=channel");
    expect(url).toContain("q=history");

    const quota = quotaInserts(admin);
    expect(quota).toHaveLength(1);
    expect(quota[0]?.["operation"]).toBe("search.list");

    const upserts = admin.recorded.filter(
      (c) => c.table === "youtube_api_cache" && c.op === "upsert",
    );
    const written = upserts[0]?.payload as { expires_at: string };
    const ttlHours = (Date.parse(written.expires_at) - Date.now()) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(0.9);
    expect(ttlHours).toBeLessThan(1.1);
  });
});

describe("parseISO8601Duration", () => {
  it.each([
    ["PT15S", 15],
    ["PT2M", 120],
    ["PT1H2M3S", 3723],
    ["P1DT2H", 93_600],
    ["PT0S", 0],
  ])("parses %s to %i seconds", (iso, expected) => {
    expect(parseISO8601Duration(iso)).toBe(expected);
  });

  it.each([null, undefined, "", "not-a-duration", "P", "PT"])("returns null for %p", (iso) => {
    expect(parseISO8601Duration(iso)).toBeNull();
  });
});
