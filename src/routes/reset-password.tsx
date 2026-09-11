import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Aperture, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Vidora AI" },
      { name: "description", content: "Choose a new password for your Vidora AI account." },
      { property: "og:title", content: "Reset password — Vidora AI" },
      { property: "og:description", content: "Choose a new password for your Vidora AI account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

const passwordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .max(72);

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [validLink, setValidLink] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setValidLink(true);
      }
    });

    // Older Supabase clients may already have the recovery session in the URL hash.
    // Calling getSession parses the hash and establishes the session if present.
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        // If there's no recovery session, check the hash directly for type=recovery
        const hash = window.location.hash;
        if (hash.includes("type=recovery") || hash.includes("access_token=")) {
          setValidLink(true);
        } else {
          setValidLink(false);
        }
      } else {
        setValidLink(true);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your password");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated — signing you in.");
      setTimeout(() => navigate({ to: "/studio", replace: true }), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (validLink === null) {
    return (
      <main className="flex min-h-[80vh] items-center justify-center bg-background px-4 py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verifying reset link…</p>
        </div>
      </main>
    );
  }

  if (validLink === false) {
    return (
      <main className="flex min-h-[80vh] items-center justify-center bg-background px-4 py-20">
        <div className="w-full max-w-md text-center">
          <span className="relative mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground">
            <Aperture className="h-5 w-5 text-primary" strokeWidth={2.4} />
          </span>
          <h1 className="text-2xl font-bold text-foreground">Invalid or expired link</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This password reset link is no longer valid. Request a new one from the sign-in page.
          </p>
          <Button className="mt-6" asChild>
            <Link to="/auth">Go to sign in</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-background px-4 py-20">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground">
            <Aperture className="h-5 w-5 text-primary" strokeWidth={2.4} />
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Choose a new password</h1>
          <p className="mt-2 text-sm text-muted-foreground">Make it strong — at least 6 characters.</p>
        </div>

        <Card className="border-border bg-card">
          <CardContent className="p-6 sm:p-8">
            {done ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="text-lg font-semibold text-foreground">Password updated</p>
                <p className="text-sm text-muted-foreground">Redirecting you to your studio…</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <Button type="submit" disabled={busy} className="w-full gap-2">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Update password
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/auth" className="hover:text-foreground">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
