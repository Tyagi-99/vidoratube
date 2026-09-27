import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccount } from "@/lib/jobs.functions";
import { ADMIN_FORBIDDEN_COPY, resolveAdminAccessState } from "@/lib/admin-access";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Gauge,
  Users,
  Film,
  FileText,
  CreditCard,
  Plug,
  Inbox,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Vidora AI" },
      {
        name: "description",
        content: "Manage users, credits, site content, pricing, integrations and renders.",
      },
      { property: "og:title", content: "Admin — Vidora AI" },
      { property: "og:description", content: "Vidora AI control panel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLayout,
});

const nav = [
  { to: "/admin", label: "Overview", icon: Gauge, exact: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/jobs", label: "Renders", icon: Film },
  { to: "/admin/content", label: "Site content", icon: FileText },
  { to: "/admin/plans", label: "Pricing", icon: CreditCard },
  { to: "/admin/integrations", label: "Integrations", icon: Plug },
  { to: "/admin/messages", label: "Inbox", icon: Inbox },
  { to: "/admin/safety", label: "Safety rules", icon: ShieldCheck },
] as const;

function AdminLayout() {
  const accountFn = useServerFn(getMyAccount);
  const account = useQuery({ queryKey: ["account"], queryFn: () => accountFn({}) });
  // S2: non-admins get a real inline 403, not a client-side redirect. The
  // actual gate is server-side (assertAdmin on every admin server function);
  // this shell only decides what to render.
  const accessState = resolveAdminAccessState({
    isLoading: account.isLoading,
    isError: account.isError,
    isAdmin: account.data?.isAdmin,
  });

  if (accessState === "loading") {
    return (
      <main className="mx-auto max-w-6xl px-4 py-20">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </main>
    );
  }

  if (accessState === "error") {
    return (
      <main className="mx-auto max-w-6xl px-4 py-20">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Couldn&apos;t load the admin panel
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {(account.error as Error)?.message ?? "Something went wrong."}
        </p>
        <div className="mt-6 flex gap-3">
          <Button onClick={() => account.refetch()}>Try again</Button>
          <Button asChild variant="outline">
            <Link to="/studio">Back to studio</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (accessState === "forbidden") {
    return (
      <main className="mx-auto max-w-6xl px-4 py-20">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {ADMIN_FORBIDDEN_COPY.title} — {ADMIN_FORBIDDEN_COPY.subtitle}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{ADMIN_FORBIDDEN_COPY.body}</p>
          </div>
        </div>
        <div className="mt-6">
          <Button asChild variant="outline">
            <Link to="/studio">Back to studio</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <Link
            to="/studio"
            className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to studio
          </Link>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: "exact" in item }}
                activeProps={{ className: "bg-primary/12 text-primary" }}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
