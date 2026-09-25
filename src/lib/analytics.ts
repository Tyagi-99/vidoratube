/**
 * Typed product-analytics events (PostHog). Everything here is a no-op until
 * VITE_POSTHOG_KEY is set — the app must work identically without analytics.
 *
 * Privacy: only ids and funnel facts are tracked. Never send emails, names,
 * script text, or any user content.
 */

import posthog from "posthog-js";

export type AnalyticsEvent =
  | { name: "signup_started"; props?: Record<string, never> }
  | { name: "signup_completed"; props?: { method?: "email" | "google" } }
  | { name: "render_started"; props: { job_id: string; mode: string } }
  | { name: "render_succeeded"; props: { job_id: string; mode: string } }
  | { name: "render_failed"; props: { job_id: string; mode: string; error_code?: string } }
  | { name: "download_clicked"; props: { job_id: string } }
  | { name: "publish_started"; props: { job_id: string } }
  | { name: "publish_succeeded"; props: { job_id: string } }
  | { name: "publish_failed"; props: { job_id: string } }
  | { name: "checkout_started"; props?: Record<string, never> };

let initialized = false;

function ensureInit(): boolean {
  if (initialized) return true;
  const key = import.meta.env["VITE_POSTHOG_KEY"] as string | undefined;
  if (!key) return false;
  const host =
    (import.meta.env["VITE_POSTHOG_HOST"] as string | undefined) ?? "https://us.i.posthog.com";
  posthog.init(key, {
    api_host: host,
    // Respect Do Not Track and keep the default (no autocapture of everything).
    respect_dnt: true,
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
  });
  initialized = true;
  return true;
}

/** Fire a typed analytics event. No-op when PostHog isn't configured. */
export function track(event: AnalyticsEvent["name"], props?: Record<string, unknown>): void {
  try {
    if (!ensureInit()) return;
    posthog.capture(event, props);
  } catch {
    // Analytics must never break the app.
  }
}

/** Identify the logged-in user by id only (no PII). No-op when unconfigured. */
export function identifyUser(userId: string): void {
  try {
    if (!ensureInit()) return;
    posthog.identify(userId);
  } catch {
    /* ignore */
  }
}

/** For tests / debugging: is analytics active right now? */
export function analyticsEnabled(): boolean {
  return ensureInit();
}
