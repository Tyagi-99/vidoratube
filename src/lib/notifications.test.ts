/**
 * Sprint 1-2: sendRenderCompleteEmail tests.
 *
 * - Flag OFF (no RESEND_API_KEY): stores the in-app notification row, sends
 *   no email, never touches the network.
 * - Flag ON: stores the row AND posts to the Resend API (mocked fetch);
 *   a failed Resend call is swallowed (emailError set) and never throws.
 * - No user email: skips sending, reports emailError.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emailFrom,
  isEmailConfigured,
  sendRenderCompleteEmail,
  type RenderCompleteInput,
} from "./notifications.server";

const baseInput: RenderCompleteInput = {
  userId: "user-1",
  userEmail: "user@example.com",
  renderId: "render-1",
  title: "My test video",
  downloadPath: "/studio",
  durationSeconds: 45,
};

function mockAdmin(insertImpl?: () => Promise<{ error: unknown }>) {
  const insert = vi.fn(
    insertImpl ?? (() => Promise.resolve({ error: null })),
  );
  const admin = { from: vi.fn().mockReturnValue({ insert }) } as unknown as Parameters<
    typeof sendRenderCompleteEmail
  >[0];
  return { admin, insert };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isEmailConfigured", () => {
  it("is false without a key", () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it("is true with a key", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(isEmailConfigured()).toBe(true);
  });

  it("emailFrom falls back to a default sender", () => {
    expect(emailFrom()).toContain("vidora.ai");
    vi.stubEnv("EMAIL_FROM", "Vidora <hello@example.com>");
    expect(emailFrom()).toBe("Vidora <hello@example.com>");
  });
});

describe("sendRenderCompleteEmail — provider off", () => {
  it("stores the notification row and sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { admin, insert } = mockAdmin();

    const result = await sendRenderCompleteEmail(admin, baseInput);

    expect(result).toEqual({ notified: true, emailed: false, emailError: null });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        type: "render_complete",
        link: "/studio",
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws when row storage fails", async () => {
    const { admin } = mockAdmin(() => Promise.resolve({ error: { message: "db down" } }));
    const result = await sendRenderCompleteEmail(admin, baseInput);
    expect(result.notified).toBe(false);
    expect(result.emailed).toBe(false);
  });
});

describe("sendRenderCompleteEmail — provider on", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
  });

  it("stores the row and posts to Resend", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    vi.stubGlobal("fetch", fetchSpy);
    const { admin } = mockAdmin();

    const result = await sendRenderCompleteEmail(admin, baseInput);

    expect(result).toEqual({ notified: true, emailed: true, emailError: null });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.subject).toContain("My test video");
    // The email never embeds the signed URL — it links back to the studio.
    expect(JSON.stringify(body)).not.toContain("signature");
  });

  it("swallows a Resend failure and keeps the notification", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("bad key") });
    vi.stubGlobal("fetch", fetchSpy);
    const { admin } = mockAdmin();

    const result = await sendRenderCompleteEmail(admin, baseInput);

    expect(result.notified).toBe(true);
    expect(result.emailed).toBe(false);
    expect(result.emailError).toContain("401");
  });

  it("skips email when the user has no email address", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { admin } = mockAdmin();

    const result = await sendRenderCompleteEmail(admin, { ...baseInput, userEmail: null });

    expect(result.notified).toBe(true);
    expect(result.emailed).toBe(false);
    expect(result.emailError).toBe("no user email");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
