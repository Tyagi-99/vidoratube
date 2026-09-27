import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  runUpdateYouTubeVideoMetadata,
  hashRemoteMetadata,
  updateSchema,
  type MetadataUpdateInput,
} from "./metadata.functions";

/**
 * Phase 4, Stream A — metadata overwrite flow tests (D140).
 * Proves: no confirm = no write; stale confirm = rejected; no-op short-circuits;
 * videos outside the test channel are refused; every overwrite is audit-logged
 * and quota-recorded. The real test-channel gate + real AES token envelope run;
 * only the YouTube HTTP calls are injected.
 */

const USER = "user-1";
const TEST_CHANNEL = "UC-test";
const YT_KEY = Buffer.from("c".repeat(32)).toString("base64");

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function makeJob(overrides: Record<string, any> = {}) {
  return {
    id: JOB_ID,
    user_id: USER,
    status: "approved",
    approved_by: USER,
    approved_at: new Date().toISOString(),
    youtube_video_id: "dQw4w9WgXcQ",
    ...overrides,
  };
}

function makeFakeAdmin(connection: any, job: any = makeJob()) {
  const tables: Record<string, any[]> = { api_usage: [] };
  const from = (table: string) => {
    const api: any = {
      select: () => api,
      eq: () => api,
      maybeSingle: async () => {
        if (table === "youtube_connections") return { data: connection, error: null };
        if (table === "publish_jobs") return { data: job, error: null };
        return { data: null, error: null };
      },
      insert: (row: any) => {
        (tables[table] ??= []).push(row);
        return { then: (resolve: (v: any) => void) => resolve({ data: row, error: null }) };
      },
    };
    return api;
  };
  return { from, tables };
}

vi.mock("@/lib/audit-log.server", () => {
  const audits: any[] = [];
  return { auditSafely: async (input: any) => void audits.push(input), __audits: audits };
});

beforeEach(async () => {
  process.env["YOUTUBE_TOKEN_ENCRYPTION_KEY"] = YT_KEY;
  process.env["YOUTUBE_TEST_CHANNEL_ID"] = TEST_CHANNEL;
  const mod = await import("@/lib/audit-log.server");
  ((mod as any).__audits ?? []).length = 0;
});

afterEach(() => {
  delete process.env["YOUTUBE_TEST_CHANNEL_ID"];
});

async function connectionFixture() {
  const { encryptToken, YOUTUBE_PUBLISH_SCOPES } = await import("../youtube.server");
  return {
    user_id: USER,
    access_token: await encryptToken("ya29.fake"),
    refresh_token: await encryptToken("refresh.fake"),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    scope: YOUTUBE_PUBLISH_SCOPES,
    channel_id: TEST_CHANNEL,
    channel_title: "Test Channel",
  };
}

function depsFixture(remote: { channelId: string | null; title: string; description: string }) {
  const calls: any[] = [];
  return {
    calls,
    fetchRemote: async (_token: string, _videoId: string) => ({ ...remote }),
    applyUpdate: async (args: { accessToken: string; videoId: string; title: string; description: string }) => {
      calls.push(args);
    },
  };
}

async function validInput(overrides: Partial<MetadataUpdateInput> = {}): Promise<MetadataUpdateInput> {
  const remoteHash = await hashRemoteMetadata("Old title", "Old description");
  return {
    video_id: "dQw4w9WgXcQ",
    title: "New title",
    description: "New description",
    confirmed: true as const,
    remote_hash: remoteHash,
    publish_job_id: JOB_ID,
    ...overrides,
  };
}

async function recordedAudits() {
  const mod = await import("@/lib/audit-log.server");
  return (mod as any).__audits as any[];
}

describe("updateSchema", () => {
  it("rejects confirmed: false — the confirm can never be defaulted", async () => {
    const input = await validInput({ confirmed: false as unknown as true });
    expect(() => updateSchema.parse(input)).toThrow(/explicitly confirm/);
  });

  it("rejects a missing remote_hash", async () => {
    const { remote_hash: _drop, ...rest } = await validInput();
    expect(() => updateSchema.parse(rest)).toThrow();
  });
});

describe("runUpdateYouTubeVideoMetadata", () => {
  it("applies the update, records quota, and audit-logs the overwrite", async () => {
    const admin = makeFakeAdmin(await connectionFixture());
    const deps = depsFixture({ channelId: TEST_CHANNEL, title: "Old title", description: "Old description" });
    const result = await runUpdateYouTubeVideoMetadata({
      supabaseAdmin: admin,
      userId: USER,
      input: await validInput(),
      deps,
    });
    expect(result).toEqual({ changed: true, videoId: "dQw4w9WgXcQ" });
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]).toMatchObject({ videoId: "dQw4w9WgXcQ", title: "New title" });
    // Quota recorded: videos.update → shared pool (D65).
    expect(admin.tables["api_usage"]).toHaveLength(1);
    expect(admin.tables["api_usage"]![0]!.operation).toBe("videos.update");
    // Audit-logged with before/after.
    const audits = await recordedAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "publish.metadata_overwritten",
      entityType: "youtube_video",
      entityId: "dQw4w9WgXcQ",
    });
    expect(audits[0].metadata.remote_title).toBe("Old title");
    expect(audits[0].metadata.new_title).toBe("New title");
  });

  it("refuses when the publish job is not approved", async () => {
    const admin = makeFakeAdmin(
      await connectionFixture(),
      makeJob({ status: "draft", approved_by: null, approved_at: null }),
    );
    const deps = depsFixture({ channelId: TEST_CHANNEL, title: "Old title", description: "Old description" });
    await expect(
      runUpdateYouTubeVideoMetadata({
        supabaseAdmin: admin,
        userId: USER,
        input: await validInput(),
        deps,
      }),
    ).rejects.toThrow(/hasn't been approved for publishing/);
    expect(deps.calls).toHaveLength(0);
  });

  it("refuses when the video is not the job's video", async () => {
    const admin = makeFakeAdmin(await connectionFixture(), makeJob({ youtube_video_id: "other-video-id" }));
    const deps = depsFixture({ channelId: TEST_CHANNEL, title: "Old title", description: "Old description" });
    await expect(
      runUpdateYouTubeVideoMetadata({
        supabaseAdmin: admin,
        userId: USER,
        input: await validInput(),
        deps,
      }),
    ).rejects.toThrow(/doesn't belong to the approved publish job/);
    expect(deps.calls).toHaveLength(0);
  });

  it("REJECTS a stale confirm (remote changed since the diff was shown)", async () => {
    const admin = makeFakeAdmin(await connectionFixture());
    const deps = depsFixture({ channelId: TEST_CHANNEL, title: "Someone else's title", description: "Old description" });
    await expect(
      runUpdateYouTubeVideoMetadata({
        supabaseAdmin: admin,
        userId: USER,
        input: await validInput(),
        deps,
      }),
    ).rejects.toThrow(/changed since you reviewed/);
    expect(deps.calls).toHaveLength(0);
    expect(await recordedAudits()).toHaveLength(0);
  });

  it("short-circuits when nothing changed (no write, no quota, no audit)", async () => {
    const admin = makeFakeAdmin(await connectionFixture());
    const deps = depsFixture({ channelId: TEST_CHANNEL, title: "Old title", description: "Old description" });
    const result = await runUpdateYouTubeVideoMetadata({
      supabaseAdmin: admin,
      userId: USER,
      input: await validInput({ title: "Old title", description: "Old description" }),
      deps,
    });
    expect(result.changed).toBe(false);
    expect(deps.calls).toHaveLength(0);
    expect(admin.tables["api_usage"]).toHaveLength(0);
  });

  it("REFUSES a video that is not on the test channel", async () => {
    const admin = makeFakeAdmin(await connectionFixture());
    const deps = depsFixture({ channelId: "UC-someone-else", title: "Old title", description: "Old description" });
    await expect(
      runUpdateYouTubeVideoMetadata({
        supabaseAdmin: admin,
        userId: USER,
        input: await validInput(),
        deps,
      }),
    ).rejects.toThrow(/does not belong to the designated test channel/);
    expect(deps.calls).toHaveLength(0);
  });

  it("REFUSES when publishing is disabled (no test channel configured)", async () => {
    delete process.env["YOUTUBE_TEST_CHANNEL_ID"];
    const admin = makeFakeDbAdmin(await connectionFixture());
    const deps = depsFixture({ channelId: TEST_CHANNEL, title: "Old title", description: "Old description" });
    await expect(
      runUpdateYouTubeVideoMetadata({
        supabaseAdmin: admin,
        userId: USER,
        input: await validInput(),
        deps,
      }),
    ).rejects.toThrow(/disabled/);
    expect(deps.calls).toHaveLength(0);
  });
});

// Local alias to keep the disabled-config test readable.
function makeFakeDbAdmin(connection: any) {
  return makeFakeAdmin(connection);
}
