import { createFileRoute, Link } from "@tanstack/react-router";
import { isAppUser, safeAuthNext } from "@/lib/auth-user";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Aperture, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { track, identifyUser } from "@/lib/analytics";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const raw = typeof search["next"] === "string" ? search["next"] : undefined;
    if (!raw) return {};
    const next = safeAuthNext(raw);
    return next === "/studio" && raw !== "/studio" ? {} : { next };
  },
  head: () => ({
    meta: [
      { title: "Sign in — Vidora AI" },
      {
        name: "description",
        content:
          "Sign in to your Vidora AI studio to generate videos, track renders and manage credits.",
      },
      { property: "og:title", content: "Sign in — Vidora AI" },
      { property: "og:description", content: "Access your Vidora AI studio dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
  displayName: z.string().trim().max(80).optional(),
});

const emailSchema = z.string().trim().email("Enter a valid email").max(255);

function AuthPage() {
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const goNext = (target?: string) => {
    // Phase 6 Stream B: brand-new signups land on the onboarding wizard when
    // there is no explicit ?next= destination. /onboarding auto-skips to
    // /studio for already-onboarded users, so this is safe for return visits.
    window.location.replace(target ?? safeAuthNext(next));
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (isAppUser(data.session?.user)) goNext();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, displayName });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        if (!errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        track("signup_started");
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/onboarding`,
            data: { display_name: parsed.data.displayName || parsed.data.email.split("@")[0] },
          },
        });
        if (error) throw error;
        track("signup_completed", { method: "email" });
        if (data.user) identifyUser(data.user.id);
        toast.success("Account created — welcome to Vidora.");
        // New accounts start the onboarding wizard; an explicit ?next=
        // destination (e.g. an invite link) still wins.
        goNext(next ? safeAuthNext(next) : "/onboarding");
        return;
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        if (data.user) identifyUser(data.user.id);
      }
      goNext();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      const friendly = message.includes("Invalid login credentials")
        ? "Wrong email or password."
        : message.includes("already registered")
          ? "That email already has an account — sign in instead."
          : message;
      setFormError(friendly);
      toast.error(friendly);
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(resetEmail);
    if (!parsed.success) {
      setResetError(parsed.error.issues[0]?.message ?? "Check your email");
      return;
    }

    setResetError(null);
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetSent(true);
      toast.success("Reset link sent — check your inbox.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      setResetError(message);
      toast.error(message);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-background px-4 py-20">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground">
            <Aperture className="h-5 w-5 text-primary" strokeWidth={2.4} />
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {mode === "signin" ? "Welcome back" : "Create your studio"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to keep rendering."
              : "Start with 10 free render credits — no card needed."}
          </p>
        </div>

        <Card className="border-border bg-card">
          <CardContent className="p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    maxLength={80}
                    aria-invalid={Boolean(fieldErrors["displayName"])}
                    aria-describedby={fieldErrors["displayName"] ? "displayName-error" : undefined}
                  />
                  {fieldErrors["displayName"] && (
                    <p id="displayName-error" className="text-sm text-destructive">
                      {fieldErrors["displayName"]}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@studio.com"
                  autoComplete="email"
                  required
                  aria-invalid={Boolean(fieldErrors["email"])}
                  aria-describedby={fieldErrors["email"] ? "email-error" : undefined}
                />
                {fieldErrors["email"] && (
                  <p id="email-error" className="text-sm text-destructive">
                    {fieldErrors["email"]}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(email);
                        setForgotOpen(true);
                      }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  aria-invalid={Boolean(fieldErrors["password"])}
                  aria-describedby={fieldErrors["password"] ? "password-error" : undefined}
                />
                {fieldErrors["password"] && (
                  <p id="password-error" className="text-sm text-destructive">
                    {fieldErrors["password"]}
                  </p>
                )}
              </div>
              {formError && (
                <div
                  role="alert"
                  className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {formError}
                </div>
              )}
              <Button type="submit" disabled={busy} className="w-full gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy
                  ? mode === "signin"
                    ? "Signing in…"
                    : "Creating account…"
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "signin" ? "New to Vidora?" : "Already have an account?"}{" "}
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Back to vidora.ai
          </Link>
        </p>
      </div>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset your password</DialogTitle>
            <DialogDescription>
              {resetSent
                ? "We sent a secure link to the address below. Click it to choose a new password."
                : "Enter the email you use for Vidora and we'll send you a reset link."}
            </DialogDescription>
          </DialogHeader>

          {resetSent ? (
            <div className="flex flex-col items-center justify-center gap-4 py-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <MailCheck className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-foreground">{resetEmail}</p>
                <p className="text-sm text-muted-foreground">Check your inbox and spam folder.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleForgot} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="resetEmail">Email</Label>
                <Input
                  id="resetEmail"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@studio.com"
                  autoComplete="email"
                  required
                  aria-invalid={Boolean(resetError)}
                  aria-describedby={resetError ? "resetEmail-error" : undefined}
                />
                {resetError && (
                  <p id="resetEmail-error" className="text-sm text-destructive" role="alert">
                    {resetError}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={resetBusy} className="w-full gap-2 sm:w-auto">
                  {resetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {resetBusy ? "Sending…" : "Send reset link"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
