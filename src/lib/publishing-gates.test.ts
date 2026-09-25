import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertMetaPublishingEnabled,
  assertMetaTestAccountAllowed,
  assertPublishJobApproved,
  assertYouTubeChannelAllowed,
  assertYouTubePublishingEnabled,
  metaTestConfig,
  PublishingDisabledError,
  PublishNotApprovedError,
  TestAccountMismatchError,
  youtubeTestChannelId,
} from "./publishing-gates.server";
import { hasForceSslScope, hasPublishScopes, hasUploadScope } from "./youtube.server";

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    YOUTUBE_TEST_CHANNEL_ID: process.env["YOUTUBE_TEST_CHANNEL_ID"],
    META_TEST_PAGE_ID: process.env["META_TEST_PAGE_ID"],
    META_TEST_IG_USER_ID: process.env["META_TEST_IG_USER_ID"],
  };
  delete process.env["YOUTUBE_TEST_CHANNEL_ID"];
  delete process.env["META_TEST_PAGE_ID"];
  delete process.env["META_TEST_IG_USER_ID"];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("YouTube test-channel gate", () => {
  it("returns null when the env var is unset or blank", () => {
    expect(youtubeTestChannelId()).toBeNull();
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "   ";
    expect(youtubeTestChannelId()).toBeNull();
  });

  it("returns the trimmed channel id when set", () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "  UC_test123  ";
    expect(youtubeTestChannelId()).toBe("UC_test123");
  });

  it("DISABLES publishing when unset — never silently", () => {
    expect(() => assertYouTubePublishingEnabled()).toThrow(PublishingDisabledError);
    try {
      assertYouTubePublishingEnabled();
    } catch (e) {
      expect((e as PublishingDisabledError).code).toBe("PUBLISHING_DISABLED");
      // The message must tell the founder exactly what to do.
      expect((e as Error).message).toContain("YOUTUBE_TEST_CHANNEL_ID");
    }
  });

  it("refuses a channel that is not the test channel", () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test123";
    expect(() => assertYouTubeChannelAllowed("UC_someone_else")).toThrow(
      TestAccountMismatchError,
    );
  });

  it("fails closed when the connected channel is unknown", () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test123";
    expect(() => assertYouTubeChannelAllowed(null)).toThrow(TestAccountMismatchError);
    expect(() => assertYouTubeChannelAllowed(undefined)).toThrow(TestAccountMismatchError);
  });

  it("allows the designated test channel", () => {
    process.env["YOUTUBE_TEST_CHANNEL_ID"] = "UC_test123";
    expect(() => assertYouTubeChannelAllowed("UC_test123")).not.toThrow();
  });
});

describe("Meta test-account gate", () => {
  it("gates Facebook and Instagram independently", () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    // Instagram unset -> IG disabled, FB enabled.
    expect(metaTestConfig()).toEqual({ pageId: "111", igUserId: null });
    expect(assertMetaPublishingEnabled("facebook")).toBe("111");
    expect(() => assertMetaPublishingEnabled("instagram")).toThrow(PublishingDisabledError);
    try {
      assertMetaPublishingEnabled("instagram");
    } catch (e) {
      expect((e as Error).message).toContain("META_TEST_IG_USER_ID");
    }
  });

  it("refuses a non-test target account", () => {
    process.env["META_TEST_PAGE_ID"] = "111";
    process.env["META_TEST_IG_USER_ID"] = "222";
    expect(() => assertMetaTestAccountAllowed("facebook", "999")).toThrow(
      TestAccountMismatchError,
    );
    expect(() => assertMetaTestAccountAllowed("instagram", "999")).toThrow(
      TestAccountMismatchError,
    );
    expect(() => assertMetaTestAccountAllowed("facebook", "111")).not.toThrow();
    expect(() => assertMetaTestAccountAllowed("instagram", "222")).not.toThrow();
  });
});

describe("publish approval gate", () => {
  const approved = {
    status: "approved",
    approved_by: "user-1",
    approved_at: new Date().toISOString(),
  };

  it("BLOCKS a missing job", () => {
    expect(() => assertPublishJobApproved(null)).toThrow(PublishNotApprovedError);
    expect(() => assertPublishJobApproved(undefined)).toThrow(PublishNotApprovedError);
  });

  it("BLOCKS drafts — nothing publishes without human approval", () => {
    expect(() =>
      assertPublishJobApproved({ status: "draft", approved_by: null, approved_at: null }),
    ).toThrow(PublishNotApprovedError);
  });

  it("BLOCKS approved status without the approval record (tampered row)", () => {
    expect(() =>
      assertPublishJobApproved({ status: "approved", approved_by: null, approved_at: null }),
    ).toThrow(PublishNotApprovedError);
    expect(() =>
      assertPublishJobApproved({ status: "approved", approved_by: "user-1", approved_at: null }),
    ).toThrow(PublishNotApprovedError);
  });

  it("allows approved and scheduled jobs with a full approval record", () => {
    expect(() => assertPublishJobApproved(approved)).not.toThrow();
    expect(() =>
      assertPublishJobApproved({ ...approved, status: "scheduled" }),
    ).not.toThrow();
  });

  it("carries a machine-readable code for the UI", () => {
    try {
      assertPublishJobApproved({ status: "draft", approved_by: null, approved_at: null });
    } catch (e) {
      expect((e as PublishNotApprovedError).code).toBe("PUBLISH_NOT_APPROVED");
    }
  });
});

describe("YouTube publish scopes", () => {
  const UPLOAD = "https://www.googleapis.com/auth/youtube.upload";
  const FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl";
  const READONLY = "https://www.googleapis.com/auth/youtube.readonly";

  it("hasUploadScope only checks the upload scope", () => {
    expect(hasUploadScope(`${READONLY} ${UPLOAD}`)).toBe(true);
    expect(hasUploadScope(READONLY)).toBe(false);
    expect(hasUploadScope(null)).toBe(false);
  });

  it("hasPublishScopes requires upload AND force-ssl (scheduling needs videos.update)", () => {
    expect(hasPublishScopes(`${READONLY} ${UPLOAD}`)).toBe(false);
    expect(hasPublishScopes(UPLOAD)).toBe(false);
    expect(hasPublishScopes(`${UPLOAD} ${FORCE_SSL}`)).toBe(true);
    expect(hasPublishScopes(null)).toBe(false);
  });

  it("hasForceSslScope checks the scheduling scope", () => {
    expect(hasForceSslScope(FORCE_SSL)).toBe(true);
    expect(hasForceSslScope(UPLOAD)).toBe(false);
  });
});
