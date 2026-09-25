import { describe, expect, it } from "vitest";
import {
  APPROVAL_SCOPES,
  approvalScopeForPrivacy,
  hasPublishApproval,
  recordApproval,
  recordPublishWarning,
  requirePublishApproval,
} from "./publish-approval";

/** Minimal thenable query-builder mock over an in-memory approvals table. */
function mockAdmin(approvals: any[], opts: { insertError?: string } = {}) {
  const inserted: any[] = [];
  return {
    inserted,
    from: (table: string) => {
      if (table !== "approvals" && table !== "publish_warnings") {
        throw new Error(`unexpected table ${table}`);
      }
      const filters: ((r: any) => boolean)[] = [];
      const api: any = {
        select: () => api,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return api;
        },
        limit: () => api,
        maybeSingle: async () => {
          const row = approvals.find((r) => filters.every((f) => f(r))) ?? null;
          return { data: row, error: null };
        },
        insert: async (row: any) => {
          if (opts.insertError) return { error: { message: opts.insertError } };
          inserted.push({ table, row });
          approvals.push(row);
          return { error: null };
        },
      };
      return api;
    },
  };
}

const LOOKUP = {
  userId: "user-1",
  publishJobId: "job-1",
  scope: "youtube-public" as const,
};

describe("approvalScopeForPrivacy", () => {
  it("maps YouTube privacy levels to approval scopes", () => {
    expect(approvalScopeForPrivacy("public")).toBe("youtube-public");
    expect(approvalScopeForPrivacy("unlisted")).toBe("youtube-unlisted");
    expect(approvalScopeForPrivacy("private")).toBe("youtube-private");
  });

  it("throws for unknown privacy", () => {
    expect(() => approvalScopeForPrivacy("everyone")).toThrow();
  });

  it("every scope is a known approvals scope", () => {
    for (const s of ["youtube-public", "youtube-unlisted", "youtube-private"]) {
      expect(APPROVAL_SCOPES).toContain(s);
    }
  });
});

describe("requirePublishApproval", () => {
  it("REJECTS when no approval row exists", async () => {
    const admin = mockAdmin([]);
    await expect(requirePublishApproval(admin, LOOKUP)).rejects.toThrow(
      /no human approval/i,
    );
  });

  it("PROCEEDS when a matching approval row exists", async () => {
    const admin = mockAdmin([
      {
        user_id: "user-1",
        publish_job_id: "job-1",
        scope: "youtube-public",
      },
    ]);
    await expect(requirePublishApproval(admin, LOOKUP)).resolves.toBeUndefined();
  });

  it("REJECTS when the approval is for a different scope", async () => {
    const admin = mockAdmin([
      { user_id: "user-1", publish_job_id: "job-1", scope: "youtube-private" },
    ]);
    await expect(requirePublishApproval(admin, LOOKUP)).rejects.toThrow(
      /no human approval/i,
    );
  });

  it("REJECTS when the approval belongs to a different job", async () => {
    const admin = mockAdmin([
      { user_id: "user-1", publish_job_id: "job-2", scope: "youtube-public" },
    ]);
    await expect(requirePublishApproval(admin, LOOKUP)).rejects.toThrow(
      /no human approval/i,
    );
  });

  it("REJECTS when the approval belongs to a different user", async () => {
    const admin = mockAdmin([
      { user_id: "user-2", publish_job_id: "job-1", scope: "youtube-public" },
    ]);
    await expect(requirePublishApproval(admin, LOOKUP)).rejects.toThrow(
      /no human approval/i,
    );
  });

  it("hasPublishApproval returns false/true accordingly", async () => {
    expect(await hasPublishApproval(mockAdmin([]), LOOKUP)).toBe(false);
    expect(
      await hasPublishApproval(
        mockAdmin([{ user_id: "user-1", publish_job_id: "job-1", scope: "youtube-public" }]),
        LOOKUP,
      ),
    ).toBe(true);
  });
});

describe("recordApproval / recordPublishWarning", () => {
  it("writes the approval row with all fields", async () => {
    const admin = mockAdmin([]);
    await recordApproval(admin, {
      userId: "user-1",
      projectId: "proj-1",
      videoId: "vid-1",
      publishJobId: "job-1",
      approverId: "user-1",
      scope: "youtube-private",
      notes: "low score warning",
    });
    expect(admin.inserted).toHaveLength(1);
    const row = admin.inserted[0].row;
    expect(row.user_id).toBe("user-1");
    expect(row.scope).toBe("youtube-private");
    expect(row.approver_id).toBe("user-1");
    // The row written by the server is now discoverable by the gate.
    await expect(
      requirePublishApproval(admin, {
        userId: "user-1",
        publishJobId: "job-1",
        scope: "youtube-private",
      }),
    ).resolves.toBeUndefined();
  });

  it("surfaces insert failures instead of silently passing", async () => {
    const admin = mockAdmin([], { insertError: "db exploded" });
    await expect(
      recordApproval(admin, {
        userId: "user-1",
        projectId: "proj-1",
        videoId: null,
        publishJobId: "job-1",
        approverId: "user-1",
        scope: "youtube-public",
        notes: null,
      }),
    ).rejects.toThrow(/could not record the approval/i);
  });

  it("records publish warnings", async () => {
    const admin = mockAdmin([]);
    await recordPublishWarning(admin, {
      userId: "user-1",
      projectId: "proj-1",
      publishJobId: "job-1",
      kind: "safety-low-score",
      message: "Published with safety score 42/100",
    });
    expect(admin.inserted).toHaveLength(1);
    expect(admin.inserted[0].row.kind).toBe("safety-low-score");
  });
});
