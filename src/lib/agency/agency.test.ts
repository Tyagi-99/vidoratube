import { describe, expect, it } from "vitest";
import {
  brandKitSchema,
  buildBulkScheduledRow,
  bulkScheduleSchema,
  canDecideApproval,
  canDecideWorkspaceApproval,
  canEditWorkspace,
  canManageMembers,
  canReadWorkspace,
  canRequestApproval,
  isSafeLogoPath,
  normalizeHexColor,
  resolveExportMeta,
  validateBulkSchedule,
  watermarkEnabledForTier,
} from "./agency";

const WS = "11111111-1111-4111-8111-111111111111";
const CH = "22222222-2222-4222-8222-222222222222";
const CH2 = "33333333-3333-4333-8333-333333333333";
const PROJ = "44444444-4444-4444-8444-444444444444";
const VID = "55555555-5555-4555-8555-555555555555";
const VID2 = "66666666-6666-4666-8666-666666666666";
const VID3 = "77777777-7777-4777-8777-777777777777";

function future(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

describe("workspace roles", () => {
  it("every role can read", () => {
    expect(canReadWorkspace("owner")).toBe(true);
    expect(canReadWorkspace("editor")).toBe(true);
    expect(canReadWorkspace("viewer")).toBe(true);
    expect(canReadWorkspace(null)).toBe(false);
    expect(canReadWorkspace(undefined)).toBe(false);
  });

  it("only owner/editor can edit — viewers cannot", () => {
    expect(canEditWorkspace("owner")).toBe(true);
    expect(canEditWorkspace("editor")).toBe(true);
    // The client (viewer) must never mutate workspace data.
    expect(canEditWorkspace("viewer")).toBe(false);
    expect(canEditWorkspace(null)).toBe(false);
  });

  it("only owners manage members", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("editor")).toBe(false);
    expect(canManageMembers("viewer")).toBe(false);
  });

  it("owners/editors request approvals; every member (incl. viewer) decides", () => {
    expect(canRequestApproval("owner")).toBe(true);
    expect(canRequestApproval("editor")).toBe(true);
    expect(canRequestApproval("viewer")).toBe(false);
    expect(canDecideApproval("viewer")).toBe(true);
    expect(canDecideApproval("editor")).toBe(true);
    expect(canDecideApproval("owner")).toBe(true);
    expect(canDecideApproval(null)).toBe(false);
  });
});

describe("white-label watermark gating", () => {
  it("free tier keeps the watermark; paid tiers export clean", () => {
    expect(watermarkEnabledForTier("free")).toBe(true);
    expect(watermarkEnabledForTier("creator")).toBe(false);
    expect(watermarkEnabledForTier("studio")).toBe(false);
  });
});

describe("brand kit", () => {
  it("normalizes hex colors", () => {
    expect(normalizeHexColor("#f59e0b")).toBe("#F59E0B");
    expect(normalizeHexColor("#fff")).toBe("#FFFFFF");
    expect(normalizeHexColor("  #abc  ")).toBe("#AABBCC");
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("#1234567")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });

  it("brandKitSchema enforces DB constraints", () => {
    const ok = brandKitSchema.parse({
      logoPath: null,
      primaryColor: "#F59E0B",
      secondaryColor: "#111827",
      fontFamily: "Inter",
    });
    expect(ok.primaryColor).toBe("#F59E0B");
    expect(() => brandKitSchema.parse({ primaryColor: "red", secondaryColor: "#111827", fontFamily: "Inter" })).toThrow();
    expect(() => brandKitSchema.parse({ primaryColor: "#F59E0B", secondaryColor: "#111827", fontFamily: "" })).toThrow();
    expect(() => brandKitSchema.parse({ primaryColor: "#F59E0B", secondaryColor: "#111827", fontFamily: "x".repeat(61) })).toThrow();
  });

  it("rejects unsafe logo paths (traversal / absolute / foreign folders)", () => {
    expect(isSafeLogoPath(null, WS)).toBe(true);
    expect(isSafeLogoPath(`${WS}/logo.png`, WS)).toBe(true);
    expect(isSafeLogoPath(`../${WS}/logo.png`, WS)).toBe(false);
    expect(isSafeLogoPath(`/etc/passwd`, WS)).toBe(false);
    expect(isSafeLogoPath(`https://evil.test/logo.png`, WS)).toBe(false);
    expect(isSafeLogoPath(`other-workspace/logo.png`, WS)).toBe(false);
  });
});

describe("resolveExportMeta", () => {
  const kit = {
    primary_color: "#ff0000",
    secondary_color: "#00ff00",
    logo_path: `${WS}/logo.png`,
    font_family: "Syne",
  };

  it("free tier: watermark on, brand kit threaded in", () => {
    const meta = resolveExportMeta({ planTier: "free", brandKit: kit });
    expect(meta.watermark).toBe(true);
    expect(meta.brandOverlay).toEqual({
      primaryColor: "#FF0000",
      secondaryColor: "#00FF00",
      logoPath: `${WS}/logo.png`,
      fontFamily: "Syne",
    });
  });

  it("paid tier: watermark off, brand kit threaded in", () => {
    const meta = resolveExportMeta({ planTier: "studio", brandKit: kit });
    expect(meta.watermark).toBe(false);
    expect(meta.brandOverlay).not.toBeNull();
  });

  it("no brand kit: overlay null, watermark still tier-gated", () => {
    expect(resolveExportMeta({ planTier: "creator", brandKit: null })).toEqual({
      watermark: false,
      brandOverlay: null,
    });
    expect(resolveExportMeta({ planTier: "free", brandKit: null }).watermark).toBe(true);
  });
});

describe("bulk scheduling", () => {
  function item(overrides: Record<string, unknown> = {}) {
    return {
      projectId: PROJ,
      videoJobId: VID,
      clientChannelId: CH,
      scheduledFor: future(60),
      ...overrides,
    };
  }

  it("schema bounds items to 1..50 and requires future datetimes", () => {
    const parsed = bulkScheduleSchema.parse({ workspaceId: WS, items: [item()] });
    expect(parsed.items).toHaveLength(1);
    expect(() => bulkScheduleSchema.parse({ workspaceId: WS, items: [] })).toThrow();
    expect(() =>
      bulkScheduleSchema.parse({
        workspaceId: WS,
        items: Array.from({ length: 51 }, () => item()),
      }),
    ).toThrow();
    expect(() => bulkScheduleSchema.parse({ workspaceId: WS, items: [item({ scheduledFor: "not-a-date" })] })).toThrow();
  });

  it("accepts a valid multi-channel batch", () => {
    const input = bulkScheduleSchema.parse({
      workspaceId: WS,
      items: [
        item({ videoJobId: VID, clientChannelId: CH, scheduledFor: future(60) }),
        item({ videoJobId: VID2, clientChannelId: CH2, scheduledFor: future(60) }),
        item({ videoJobId: VID3, clientChannelId: CH, scheduledFor: future(180) }),
      ],
    });
    expect(validateBulkSchedule(input)).toEqual({ ok: true });
  });

  it("rejects past times, double-booked channels, and repeated videos", () => {
    const input = bulkScheduleSchema.parse({
      workspaceId: WS,
      items: [
        item({ videoJobId: VID, clientChannelId: CH, scheduledFor: future(60) }),
        item({ videoJobId: VID2, clientChannelId: CH, scheduledFor: future(60) }),
        item({ videoJobId: VID, clientChannelId: CH2, scheduledFor: future(120) }),
        item({ videoJobId: VID2, clientChannelId: CH2, scheduledFor: new Date(Date.now() - 60_000).toISOString() }),
      ],
    });
    const result = validateBulkSchedule(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/already booked/);
      expect(result.errors.join("\n")).toMatch(/already scheduled/);
      expect(result.errors.join("\n")).toMatch(/must be in the future/);
    }
  });

  it("bulk-scheduled rows are ALWAYS drafts — never auto-publish", () => {
    const row = buildBulkScheduledRow({
      userId: "user-1",
      workspaceId: WS,
      item: bulkScheduleSchema.parse({ workspaceId: WS, items: [item()] }).items[0]!,
    });
    expect(row.status).toBe("draft");
    expect(row.workspace_id).toBe(WS);
    expect(row.client_channel_id).toBe(CH);
  });
});

describe("approval transitions", () => {
  it("only pending approvals can be decided, by any member", () => {
    expect(canDecideWorkspaceApproval({ currentStatus: "pending", nextStatus: "approved", actorRole: "viewer" })).toBe(true);
    expect(canDecideWorkspaceApproval({ currentStatus: "pending", nextStatus: "rejected", actorRole: "viewer" })).toBe(true);
    // Decided approvals are terminal.
    expect(canDecideWorkspaceApproval({ currentStatus: "approved", nextStatus: "rejected", actorRole: "owner" })).toBe(false);
    expect(canDecideWorkspaceApproval({ currentStatus: "rejected", nextStatus: "approved", actorRole: "owner" })).toBe(false);
    // Non-members cannot decide.
    expect(canDecideWorkspaceApproval({ currentStatus: "pending", nextStatus: "approved", actorRole: null })).toBe(false);
    // Invalid target statuses rejected.
    expect(
      canDecideWorkspaceApproval({ currentStatus: "pending", nextStatus: "pending" as never, actorRole: "owner" }),
    ).toBe(false);
  });
});
