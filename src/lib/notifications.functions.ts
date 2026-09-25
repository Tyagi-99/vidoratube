/**
 * Sprint 1-2: client-facing notification server functions.
 * RLS lets users SELECT their own rows; marking read uses the user-scoped
 * client with a user_id guard so nobody can mark someone else's rows.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppUser } from "./server-auth";

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireAppUser])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id,type,title,body,link,read_at,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireAppUser])
  .inputValidator((i: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).max(50).default([]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("read_at", null);
    if (data.ids.length > 0) q = q.in("id", data.ids);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
