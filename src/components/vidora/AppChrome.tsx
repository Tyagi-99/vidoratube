import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Aperture, Coins, Film, LogOut, Menu, Plus, Shield, X } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/vidora/LanguageToggle";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccount } from "@/lib/jobs.functions";

const links = [
  { label: "Studio", to: "/studio" as const },
  { label: "Projects", to: "/projects" as const },
  { label: "Research", to: "/research" as const },
  { label: "Analytics", to: "/analytics" as const },
  { label: "Billing", to: "/billing" as const },
];

export function AppChrome() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountFn = useServerFn(getMyAccount);
  const account = useQuery({ queryKey: ["account"], queryFn: () => accountFn({}) });

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link to="/studio" aria-label="Vidora studio" className="flex shrink-0 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-card">
            <Aperture className="size-4 text-accent" aria-hidden="true" />
          </span>
          <span className="font-display text-base font-semibold text-foreground">Vidora</span>
        </Link>

        <nav aria-label="Studio" className="hidden h-full items-center gap-1 md:flex">
          {links.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/studio" }}
              activeProps={{ className: "text-foreground after:opacity-100" }}
              className="relative flex h-full items-center px-3 text-sm font-medium text-muted-foreground transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-accent after:opacity-0 hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
          {account.data?.isAdmin && (
            <Link
              to="/admin"
              activeProps={{ className: "text-foreground after:opacity-100" }}
              className="relative flex h-full items-center gap-1.5 px-3 text-sm font-medium text-muted-foreground transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-accent after:opacity-0 hover:text-foreground"
            >
              <Shield className="size-3.5" aria-hidden="true" /> Admin
            </Link>
          )}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <div className="flex min-h-11 items-center gap-2 border-r border-border pr-4 text-sm text-muted-foreground">
            <Coins className="size-4 text-accent" aria-hidden="true" />
            <span className="tabular-nums">
              {account.isLoading ? "—" : (account.data?.profile?.credits ?? 0)}
            </span>
            <span>credits</span>
          </div>
          <ThemeToggle />
          <LanguageToggle compact />
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            aria-label="Sign out"
            className="size-11"
          >
            <LogOut className="size-4" />
          </Button>
          <Button asChild className="gap-2">
            <Link to="/studio" search={{ create: "script" }}>
              <Plus className="size-4" /> New video
            </Link>
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <LanguageToggle compact />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-label="Toggle studio navigation"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          aria-label="Mobile studio"
          className="border-t border-border bg-background px-4 py-3 md:hidden"
        >
          <div className="mx-auto grid max-w-[1440px] gap-1">
            {links.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex min-h-11 items-center gap-2 border-b border-border px-2 text-sm font-medium"
                onClick={() => setMobileOpen(false)}
              >
                <Film className="size-4 text-muted-foreground" aria-hidden="true" /> {item.label}
              </Link>
            ))}
            {account.data?.isAdmin && (
              <Link
                to="/admin"
                className="flex min-h-11 items-center gap-2 border-b border-border px-2 text-sm font-medium"
                onClick={() => setMobileOpen(false)}
              >
                <Shield className="size-4 text-muted-foreground" aria-hidden="true" /> Admin
              </Link>
            )}
            <div className="flex items-center justify-between gap-2 pt-2">
              <span className="text-sm text-muted-foreground">
                <span className="tabular-nums text-foreground">
                  {account.data?.profile?.credits ?? 0}
                </span>{" "}
                credits
              </span>
              <Button variant="ghost" onClick={signOut} className="gap-2">
                <LogOut className="size-4" /> Sign out
              </Button>
              <Button asChild size="sm">
                <Link
                  to="/studio"
                  search={{ create: "script" }}
                  onClick={() => setMobileOpen(false)}
                >
                  <Plus className="size-4" /> New video
                </Link>
              </Button>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
