import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./admin.server";

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [users, jobs, completed, messages, plans, integrations] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("video_jobs").select("id", { count: "exact", head: true }),
      supabase.from("video_jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("contact_messages").select("id", { count: "exact", head: true }).eq("handled", false),
      supabase.from("pricing_plans").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("integrations").select("id", { count: "exact", head: true }).eq("enabled", true),
    ]);

    const { data: recentJobs } = await supabase
      .from("video_jobs")
      .select("id, title, status, created_at, user_id, credits_used")
      .order("created_at", { ascending: false })
      .limit(8);

    return {
      users: users.count ?? 0,
      jobs: jobs.count ?? 0,
      completed: completed.count ?? 0,
      openMessages: messages.count ?? 0,
      activePlans: plans.count ?? 0,
      liveIntegrations: integrations.count ?? 0,
      recentJobs: recentJobs ?? [],
    };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [{ data: profiles, error }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (error) throw new Error(error.message);

    const roleMap = new Map<string, string[]>();
    for (const row of roles ?? []) {
      roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
    }

    return (profiles ?? []).map((p) => ({ ...p, roles: roleMap.get(p.id) ?? [] }));
  });

export const adminAdjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        delta: z.number().int().min(-10000).max(10000),
        reason: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) throw new Error("User not found");

    const next = Math.max(0, profile.credits + data.delta);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ credits: next })
      .eq("id", data.userId);
    if (updateError) throw new Error(updateError.message);

    await supabase.from("credit_ledger").insert({
      user_id: data.userId,
      delta: data.delta,
      reason: data.reason,
      admin_id: userId,
    });

    return { credits: next };
  });

export const adminSetUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ userId: z.string().uuid(), status: z.enum(["active", "suspended"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("profiles")
      .update({ status: data.status })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ userId: z.string().uuid(), makeAdmin: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    if (data.userId === userId && !data.makeAdmin) {
      throw new Error("You can't remove your own admin access.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.makeAdmin) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminListJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const [{ data: jobs, error }, { data: profiles }] = await Promise.all([
      supabase.from("video_jobs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("profiles").select("id, email, display_name"),
    ]);
    if (error) throw new Error(error.message);

    const owners = new Map((profiles ?? []).map((p) => [p.id, p]));
    return (jobs ?? []).map((job) => ({
      ...job,
      owner: owners.get(job.user_id)?.email ?? owners.get(job.user_id)?.display_name ?? "unknown",
    }));
  });

export const adminDeleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase.from("video_jobs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase.from("site_content").select("*").order("key");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSaveContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ key: z.string().trim().min(1).max(60), value: z.record(z.string(), z.string()) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("site_content")
      .update({ value: data.value })
      .eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("pricing_plans")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSavePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(60),
        price_monthly: z.number().min(0).max(100000),
        credits: z.number().int().min(0).max(1000000),
        blurb: z.string().trim().max(200),
        features: z.array(z.string().trim().max(160)).max(20),
        highlighted: z.boolean(),
        active: z.boolean(),
        sort_order: z.number().int().min(0).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { id, ...fields } = data;
    const { error } = await supabase.from("pricing_plans").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase.from("integrations").select("*").order("category");
    if (error) throw new Error(error.message);

    // Never return secret values — only whether the secret is present.
    return (data ?? []).map((row) => ({
      ...row,
      secret_present: row.secret_name ? Boolean(process.env[row.secret_name]) : false,
    }));
  });

export const adminSaveIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300),
        enabled: z.boolean(),
        settings: z.record(z.string(), z.string()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { id, ...fields } = data;
    const { error } = await supabase
      .from("integrations")
      .update({
        ...fields,
        status: fields.enabled ? "connected" : "not_configured",
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("contact_messages")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSetMessageHandled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), handled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("contact_messages")
      .update({ handled: data.handled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
