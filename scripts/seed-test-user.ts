/**
 * Seed a test user for E2E tests.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-test-user.ts
 *
 * Creates (or reuses) `e2e-test@vidora.local` with a confirmed email,
 * 50 credits, and prints TEST_USER_EMAIL / TEST_USER_PASSWORD for the
 * Playwright run. The password is generated randomly and printed once —
 * store it in CI secrets, never in the repo.
 */
import { randomBytes } from "node:crypto";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const EMAIL = "e2e-test@vidora.local";
const PASSWORD = randomBytes(16).toString("hex");

async function admin(path: string, options: RequestInit = {}) {
  const res = await fetch(`${url}/auth/v1/admin${path}`, {
    ...options,
    headers: {
      apikey: serviceKey!,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// Find or create the user
const { users } = await admin("/users");
let user = users.find((u: any) => u.email === EMAIL);
if (!user) {
  user = await admin("/users", {
    method: "POST",
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { e2e_test: true },
    }),
  });
  console.log("Created test user:", EMAIL);
} else {
  // Reset password so the printed one works
  await admin(`/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({ password: PASSWORD }),
  });
  console.log("Reused test user:", EMAIL);
}

// Grant 50 credits via the atomic adjust function (service_role)
const rpc = await fetch(`${url}/rest/v1/rpc/adjust_credits`, {
  method: "POST",
  headers: {
    apikey: serviceKey!,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    p_user_id: user.id,
    p_delta: 50,
    p_reason: "e2e seed",
  }),
});
if (!rpc.ok) console.warn("credit grant failed:", await rpc.text());
else console.log("Granted 50 test credits");

console.log("\nSet these for Playwright:");
console.log(`TEST_USER_EMAIL=${EMAIL}`);
console.log(`TEST_USER_PASSWORD=${PASSWORD}`);
