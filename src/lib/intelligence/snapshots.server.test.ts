/**
 * Stream A — unit tests for snapshots.server.ts.
 * Deterministic: Supabase is a fake in-memory client; growth math uses fixed
 * fixtures (no network, no clock dependence).
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  computeSubscriberGrowthPct,
  writeChannelSnapshot,
  writeVideoSnapshot,
  type ChannelRow,
  type ChannelSnapshotRow,
  type VideoRow,
  type VideoSnapshotRow,
} from "./snapshots.server";
import type { DbListResult, DbQuery, DbSingleResult } from "./youtube-api.server";

/* ------------------------------------------------------------------ */
/* Fake Supabase admin                                                 */
/* ------------------------------------------------------------------ */

type Filter = { col: string; val: unknown };

class FakeQuery implements DbQuery {
  private filters: Filter[] = [];
  private payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;

  constructor(
    private readonly table: string,
    private readonly admin: FakeAdmin,
  ) {}

  select(): DbQuery {
    return this;
  }
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>): DbQuery {
    this.payload = values;
    this.admin.recorded.push({ table: this.table, op: "insert", payload: values });
    return this;
  }
  upsert(values: Record<string, unknown> | Array<Record<string, unknown>>): DbQuery {
    this.payload = values;
    this.admin.recorded.push({ table: this.table, op: "upsert", payload: values });
    return this;
  }
  update(values: Record<string, unknown>): DbQuery {
    this.payload = values;
    this.admin.recorded.push({ table: this.table, op: "update", payload: values });
    return this;
  }
  delete(): DbQuery {
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
    const found = this.admin.findOne(this.table, this.filters);
    return { data: (found ?? null) as T | null, error: null };
  }

  async single<T>(): Promise<DbSingleResult<T>> {
    const base = (Array.isArray(this.payload) ? this.payload[0] : this.payload) as Record<
      string,
      unknown
    > | null;
    const row = {
      ...(base ?? {}),
      id: `gen-${++this.admin.seq}`,
      captured_at: "2026-09-28T00:00:00.000Z",
    };
    return { data: row as T, error: null };
  }

  then<TResult>(
    onfulfilled?:
      ((value: DbListResult<unknown>) => TResult | PromiseLike<TResult>) | undefined | null,
  ): PromiseLike<TResult> {
    const value: DbListResult<unknown> = { data: [], error: null };
    const result = onfulfilled ? onfulfilled(value) : (value as unknown as TResult);
    return Promise.resolve(result);
  }
}

class FakeAdmin {
  seq = 0;
  recorded: Array<{ table: string; op: string; payload?: unknown }> = [];
  channels: Array<Record<string, unknown>> = [];
  videos: Array<Record<string, unknown>> = [];

  from(table: string): DbQuery {
    return new FakeQuery(table, this);
  }

  findOne(table: string, filters: Filter[]): Record<string, unknown> | null {
    const pool = table === "channels" ? this.channels : table === "videos" ? this.videos : [];
    return pool.find((row) => filters.every((f) => row[f.col] === f.val)) ?? null;
  }
}

const asAdmin = (f: FakeAdmin): SupabaseClient<Database> =>
  f as unknown as SupabaseClient<Database>;

const USER_ID = "user-1";
const CHANNEL_ID = "chan-1";
const VIDEO_ID = "vid-1";

function seededAdmin(): FakeAdmin {
  const admin = new FakeAdmin();
  admin.channels.push({ id: CHANNEL_ID, user_id: USER_ID } as Record<string, unknown>);
  admin.videos.push({ id: VIDEO_ID, user_id: USER_ID } as Record<string, unknown>);
  return admin;
}

/* ------------------------------------------------------------------ */

describe("writeChannelSnapshot", () => {
  it("writes a snapshot row for an owned channel and returns it", async () => {
    const admin = seededAdmin();
    const row = await writeChannelSnapshot(asAdmin(admin), USER_ID, CHANNEL_ID, {
      subscriberCount: 1000,
      videoCount: 42,
      viewCount: 99_000,
      metrics: { source: "youtube-data-api" },
    });

    expect(row.channel_id).toBe(CHANNEL_ID);
    expect(row.subscriber_count).toBe(1000);
    expect(row.video_count).toBe(42);
    expect(row.view_count).toBe(99_000);

    const insert = admin.recorded.find((c) => c.table === "channel_snapshots" && c.op === "insert");
    expect(insert).toBeDefined();
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload["user_id"]).toBe(USER_ID);
    expect(payload["channel_id"]).toBe(CHANNEL_ID);
    expect(payload["subscriber_count"]).toBe(1000);
  });

  it("stores nulls for missing counters (never invents them)", async () => {
    const admin = seededAdmin();
    const row = await writeChannelSnapshot(asAdmin(admin), USER_ID, CHANNEL_ID, {});
    expect(row.subscriber_count).toBeNull();
    expect(row.video_count).toBeNull();
    expect(row.view_count).toBeNull();
  });

  it("rejects a channel that does not belong to the user", async () => {
    const admin = new FakeAdmin(); // no channels seeded
    await expect(
      writeChannelSnapshot(asAdmin(admin), USER_ID, "other-chan", { subscriberCount: 5 }),
    ).rejects.toThrow("Channel not found.");
  });
});

describe("writeVideoSnapshot", () => {
  it("writes a snapshot row for an owned video and returns it", async () => {
    const admin = seededAdmin();
    const row = await writeVideoSnapshot(asAdmin(admin), USER_ID, VIDEO_ID, {
      viewCount: 12_000,
      likeCount: 300,
      commentCount: 12,
    });

    expect(row.video_id).toBe(VIDEO_ID);
    expect(row.view_count).toBe(12_000);
    expect(row.like_count).toBe(300);
    expect(row.comment_count).toBe(12);

    const insert = admin.recorded.find((c) => c.table === "video_snapshots" && c.op === "insert");
    expect(insert).toBeDefined();
    expect((insert?.payload as Record<string, unknown>)["user_id"]).toBe(USER_ID);
  });

  it("rejects a video that does not belong to the user", async () => {
    const admin = new FakeAdmin();
    await expect(
      writeVideoSnapshot(asAdmin(admin), USER_ID, "other-vid", { viewCount: 5 }),
    ).rejects.toThrow("Video not found.");
  });
});

/* ------------------------------------------------------------------ */
/* Growth math fixtures                                                */
/* ------------------------------------------------------------------ */

const day = (n: number): string => new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString();

const snap = (
  daysAgo: number,
  subscriberCount: number | null,
): { captured_at: string; subscriber_count: number | null } => ({
  captured_at: day(30 - daysAgo), // daysAgo relative to day 30
  subscriber_count: subscriberCount,
});

describe("computeSubscriberGrowthPct", () => {
  it("returns null with fewer than 2 snapshots", () => {
    expect(computeSubscriberGrowthPct([])).toBeNull();
    expect(computeSubscriberGrowthPct([snap(0, 1000)])).toBeNull();
  });

  it("computes 7-day growth between two snapshots", () => {
    // 1000 → 1100 over exactly 7 days = +10%
    expect(computeSubscriberGrowthPct([snap(7, 1000), snap(0, 1100)])).toBeCloseTo(10, 10);
  });

  it("picks the snapshot nearest to 7 days before the latest", () => {
    // latest at day 30 (2200); target = day 23; day 24 is nearest (not the oldest)
    const pct = computeSubscriberGrowthPct([
      snap(10, 1000), // day 20
      snap(6, 2000), // day 24 — nearest to day 23 target
      snap(0, 2200), // day 30 latest
    ]);
    expect(pct).toBeCloseTo(10, 10); // (2200-2000)/2000
  });

  it("ignores a reference snapshot newer than 24h before the latest", () => {
    const pct = computeSubscriberGrowthPct([
      { captured_at: day(20), subscriber_count: 1000 },
      {
        captured_at: new Date(Date.UTC(2026, 10, 1) - 2 * 3_600_000).toISOString(),
        subscriber_count: 1050,
      }, // 2h before latest
      { captured_at: new Date(Date.UTC(2026, 10, 1)).toISOString(), subscriber_count: 1100 },
    ]);
    // reference must fall back to day 20: (1100-1000)/1000 = 10%
    expect(pct).toBeCloseTo(10, 10);
  });

  it("returns null when no snapshot is at least 24h older than the latest", () => {
    const pct = computeSubscriberGrowthPct([
      {
        captured_at: new Date(Date.UTC(2026, 10, 1) - 3_600_000).toISOString(),
        subscriber_count: 1000,
      },
      { captured_at: new Date(Date.UTC(2026, 10, 1)).toISOString(), subscriber_count: 1005 },
    ]);
    expect(pct).toBeNull();
  });

  it("returns null when the reference count is zero (no division by zero)", () => {
    expect(computeSubscriberGrowthPct([snap(7, 0), snap(0, 100)])).toBeNull();
  });

  it("returns null when the latest count is missing", () => {
    expect(computeSubscriberGrowthPct([snap(7, 1000), snap(0, null)])).toBeNull();
  });

  it("skips snapshots with missing counts and still computes", () => {
    const pct = computeSubscriberGrowthPct([
      snap(7, 1000),
      snap(3, null), // ignored
      snap(0, 1100),
    ]);
    expect(pct).toBeCloseTo(10, 10);
  });

  it("handles negative growth", () => {
    expect(computeSubscriberGrowthPct([snap(7, 1000), snap(0, 900)])).toBeCloseTo(-10, 10);
  });

  it("sorts unsorted input before computing", () => {
    const pct = computeSubscriberGrowthPct([snap(0, 1100), snap(7, 1000)]);
    expect(pct).toBeCloseTo(10, 10);
  });
});

/* ------------------------------------------------------------------ */
/* Type-level: row shapes stay in sync with the writers                 */
/* ------------------------------------------------------------------ */

describe("row shapes", () => {
  it("exposes the expected ChannelRow / VideoRow fields", () => {
    const channel: ChannelRow = {
      id: "c",
      user_id: "u",
      workspace_id: null,
      platform: "youtube",
      external_channel_id: "UC1",
      handle: "@h",
      title: "T",
      is_own: false,
      tracked: true,
      niche_id: null,
      created_at: "2026-09-28T00:00:00.000Z",
      updated_at: "2026-09-28T00:00:00.000Z",
    };
    const video: VideoRow = {
      id: "v",
      user_id: "u",
      channel_id: "c",
      platform: "youtube",
      external_video_id: "VID",
      title: "T",
      description: "D",
      published_at: null,
      duration_seconds: 61,
      thumbnail_url: null,
      is_own: false,
      metrics: {},
      created_at: "2026-09-28T00:00:00.000Z",
      updated_at: "2026-09-28T00:00:00.000Z",
    };
    expect(channel.external_channel_id).toBe("UC1");
    expect(video.duration_seconds).toBe(61);
  });

  it("snapshot rows carry metrics jsonb", () => {
    const s: ChannelSnapshotRow = {
      id: "s",
      user_id: "u",
      channel_id: "c",
      captured_at: "2026-09-28T00:00:00.000Z",
      subscriber_count: 1,
      video_count: 2,
      view_count: 3,
      metrics: { source: "youtube-data-api" },
    };
    const vs: VideoSnapshotRow = {
      id: "s",
      user_id: "u",
      video_id: "v",
      captured_at: "2026-09-28T00:00:00.000Z",
      view_count: 1,
      like_count: 2,
      comment_count: 3,
      metrics: {},
    };
    expect(s.metrics).toEqual({ source: "youtube-data-api" });
    expect(vs.view_count).toBe(1);
  });
});
