import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { initClientSentry, captureError } from "../lib/sentry";
import { Menu, X, Aperture, ArrowUpRight, LayoutDashboard } from "lucide-react";
import { ThemeProvider, themeInitScript } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/vidora/LanguageToggle";
import { Toaster } from "@/components/ui/sonner";
import { useSession } from "@/hooks/useSession";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    captureError(error, { extra: { boundary: "tanstack_root_error_component" } });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vidora AI — Your AI video studio, on autopilot" },
      { name: "description", content: "Vidora turns a script into a 1080p MP4 with AI narration, scene stills, and burned-in captions." },
      { name: "author", content: "Vidora AI" },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Vidora AI — Your AI video studio, on autopilot" },
      { property: "og:description", content: "Turn a script into a 1080p MP4 with narration, stills, and captions." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://vidoratube.lovable.app/" },
      { property: "og:image", content: "https://vidoratube.lovable.app/og-image.png" },
      { property: "og:image:alt", content: "Vidora AI — the AI YouTube studio built to keep your channel monetized" },
      { property: "og:site_name", content: "Vidora AI" },
      { property: "og:locale", content: "en_US" },
      { property: "og:locale:alternate", content: "hi_IN" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@vidoraai" },
      { name: "twitter:title", content: "Vidora AI — Your AI video studio, on autopilot" },
      { name: "twitter:description", content: "Turn a script into a 1080p MP4 with narration, stills, and captions." },
      { name: "twitter:image", content: "https://vidoratube.lovable.app/og-image.png" },
      { name: "theme-color", content: "#0f1012" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "canonical", href: "https://vidoratube.lovable.app/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Vidora AI",
          applicationCategory: "MultimediaApplication",
          operatingSystem: "Web",
          url: "https://vidoratube.lovable.app/",
          description:
            "The AI YouTube studio built to keep your channel monetized. Research, script, voice, render, and publish YouTube videos with AI.",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          inLanguage: ["en", "hi"],
        }),
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // Sentry + PostHog initialize only when their keys are set (no-ops otherwise).
  useEffect(() => {
    initClientSentry();
  }, []);
  const authenticated =
    pathname === "/studio" ||
    pathname === "/projects" ||
    pathname.startsWith("/projects/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <div className="relative flex min-h-screen flex-col">
          {!authenticated && <Header />}
          <div className="flex-1">
            <Outlet />
          </div>
          {!authenticated && <Footer />}
        </div>
        <Toaster position="top-center" richColors />
      </ThemeProvider>
    </QueryClientProvider>
  );
}


function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const text = size === "sm" ? "text-base" : "text-lg";
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`relative flex ${box} items-center justify-center rounded-md bg-[oklch(0.82_0.145_78)]`}
      >
        <Aperture className="relative h-4 w-4 text-black" strokeWidth={2.4} />
      </span>
      <span className={`font-display ${text} font-extrabold tracking-tight text-foreground`}>
        Vidora
      </span>
    </span>
  );
}

function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading } = useSession();

  const navItems = [
    { label: "Product", to: "/features" },
    { label: "Pricing", to: "/pricing" },
    { label: "Contact", to: "/contact" },
  ] as const;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.07] bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Vidora AI home" className="shrink-0">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              activeProps={{ className: "text-foreground" }}
              className="relative rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <LanguageToggle compact />
          <ThemeToggle />
          {!loading && user ? (
            <>
              <Link
                to="/studio"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-white/5"
              >
                <LayoutDashboard className="h-4 w-4" />
                Studio
              </Link>
              <Link
                to="/studio"
                search={{ create: "script" }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-transform duration-200 hover:scale-[1.02]"
              >
                New video
              </Link>
            </>
          ) : (
            <Link
              to="/studio"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-transform duration-200 hover:scale-[1.02]"
            >
              Open studio
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <LanguageToggle compact />
          <ThemeToggle />
          <button
            className="inline-flex size-11 items-center justify-center rounded-[10px] border border-border text-foreground"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background px-4 pb-5 pt-3 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col">
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                activeProps={{ className: "text-foreground" }}
                className="flex min-h-12 items-center border-b border-border text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/studio"
              className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-primary px-4 text-base font-semibold text-primary-foreground"
              onClick={() => setMobileOpen(false)}
            >
              Open studio
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}


function Footer() {
  return (
    <footer className="w-full border-t border-white/[0.07] bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]">
          <div className="max-w-sm">
            <Wordmark size="sm" />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Script in, film out. An AI video studio in early access.
            </p>
            <p className="mt-4 font-mono text-xs text-muted-foreground/60">
              00:00:00:00 — every video starts here
            </p>
          </div>

          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground">PRODUCT</p>
            <div className="mt-5 flex flex-col gap-3">
              <Link to="/features" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Features
              </Link>
              <Link to="/pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Pricing
              </Link>
              <Link to="/studio" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Studio
              </Link>
            </div>
          </div>

          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground">COMPANY</p>
            <div className="mt-5 flex flex-col gap-3">
              <a href="mailto:hello@vidora.ai" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                hello@vidora.ai
              </a>
              <Link to="/contact" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Support
              </Link>
              <Link to="/privacy" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Privacy
              </Link>
              <Link to="/terms" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Terms
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-6 font-mono text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Vidora AI</span>
          <span>Cut in the cloud · Rendered with care</span>
        </div>
      </div>
    </footer>
  );
}


