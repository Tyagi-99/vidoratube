import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Aperture,
  Building2,
  Check,
  ChevronDown,
  Coins,
  Film,
  LogOut,
  Menu,
  Plus,
  Shield,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/vidora/LanguageToggle";
import { NotificationsBell } from "@/components/vidora/NotificationsBell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccount } from "@/lib/jobs.functions";
import { listWorkspaces } from "@/lib/agency/agency.functions";
import { directLinks, mobileLinks, navGroups, type NavItem } from "./appNav";

const desktopLinkClass =
  "relative flex h-full items-center px-3 text-sm font-medium text-muted-foreground transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-accent after:opacity-0 hover:text-foreground";
const desktopActiveClass = "text-foreground after:opacity-100";

function NavGroupMenu({
  label,
  items,
}: {
  label: string;
  items: NavItem[];
}) {
  const { pathname } = useLocation();
  const isActive = items.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label} menu`}
          className={`${desktopLinkClass} cursor-pointer gap-1 ${isActive ? desktopActiveClass : ""}`}
        >
          {label}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} asChild>
            <Link
              to={item.to}
              {...(item.search ? { search: item.search } : {})}
              className="w-full cursor-pointer"
            >
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppChrome() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountFn = useServerFn(getMyAccount);
  const account = useQuery({ queryKey: ["account"], queryFn: () => accountFn({}) });
  // Phase 4 Stream E (F40): workspace switcher data.
  const workspacesFn = useServerFn(listWorkspaces);
  const workspaces = useQuery({
    queryKey: ["chrome-workspaces"],
    queryFn: () => workspacesFn(),
    staleTime: 60_000,
  });
  const workspaceRows = workspaces.data?.workspaces ?? [];

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
          {directLinks.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/studio" }}
              activeProps={{ className: desktopActiveClass }}
              className={desktopLinkClass}
            >
              {item.label}
            </Link>
          ))}
          {navGroups.map((group) => (
            <NavGroupMenu key={group.label} label={group.label} items={group.items} />
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
          {/* Phase 4 Stream E (F40): workspace switcher. */}
          {workspaceRows.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-48 gap-2">
                  <Building2 className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {workspaceRows.length === 1
                      ? workspaceRows[0]!.name
                      : `${workspaceRows.length} workspaces`}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {workspaceRows.map((w) => (
                  <DropdownMenuItem key={w.id} asChild>
                    <Link
                      to="/agency/$workspaceId"
                      params={{ workspaceId: w.id }}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Check className="size-3.5 shrink-0 opacity-0" aria-hidden="true" />
                        <span className="truncate">{w.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{w.role}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/agency" className="flex items-center gap-2">
                    <Plus className="size-3.5" aria-hidden="true" /> All workspaces
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex min-h-11 items-center gap-2 border-r border-border pr-4 text-sm text-muted-foreground">
            <Coins className="size-4 text-accent" aria-hidden="true" />
            <span className="tabular-nums">
              {account.isLoading ? "—" : (account.data?.profile?.credits ?? 0)}
            </span>
            <span>credits</span>
          </div>
          <ThemeToggle />
          <LanguageToggle compact />
          <NotificationsBell />
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
          <NotificationsBell />
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
            {mobileLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                {...(item.search ? { search: item.search } : {})}
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
