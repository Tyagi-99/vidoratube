import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicSupabase } from "./public.server";

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
    .select("id, slug, name, price_monthly, credits, blurb, features, highlighted, sort_order")
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

export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => contactSchema.parse(input))
  .handler(async ({ data }) => {
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
