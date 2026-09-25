import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createPublicSupabase } from "./public.server";
import { createRateLimiter } from "./rate-limit";
import { detectCurrencyFromHeaders, type DisplayCurrency } from "./currency";

/**
 * Best-effort currency for this visitor: INR only when a CDN country header
 * says India, otherwise USD. The client can override with the manual toggle
 * (stored in localStorage); this value is just the initial guess.
 */
export const getDisplayCurrency = createServerFn({ method: "GET" }).handler(
  async (): Promise<DisplayCurrency> => {
    const headers = getRequest()?.headers;
    if (!headers) return "USD";
    return detectCurrencyFromHeaders((name) => headers.get(name));
  },
);

export const getSiteContent = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase.from("site_content").select("key, label, value");
  if (error) throw new Error(error.message);

  const map: Record<string, Record<string, string>> = {};
  for (const row of data ?? []) {
    map[row.key] = (row.value ?? {}) as Record<string, string>;
  }
  return map;
});

export const getPricingPlans = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase
    .from("pricing_plans")
    .select(
      "id, slug, name, price_monthly, price_monthly_inr, credits, blurb, features, highlighted, sort_order",
    )
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Enter a valid email").max(255),
  subject: z.string().trim().max(150).optional().default(""),
  message: z.string().trim().min(5, "Tell us a little more").max(2000),
});

/** 5 messages per hour per IP on the anonymous contact form. Exported for tests. */
export const contactLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => contactSchema.parse(input))
  .handler(async ({ data }) => {
    // Best-effort per-IP throttle: the form is intentionally public (no auth),
    // so without this it is an unauthenticated spam sink into contact_messages.
    // In-memory counters blunt casual abuse; they are per-instance on
    // serverless, not a hard global cap.
    if (!contactLimiter.check(clientIp())) {
      throw new Error("Too many messages — please try again later.");
    }
    const supabase = createPublicSupabase();
    const { error } = await supabase.from("contact_messages").insert({
      name: data.name,
      email: data.email,
      subject: data.subject || null,
      message: data.message,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function clientIp(): string {
  const headers = getRequest()?.headers;
  const forwarded = headers?.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers?.get("cf-connecting-ip") ?? headers?.get("x-real-ip") ?? "unknown";
}
