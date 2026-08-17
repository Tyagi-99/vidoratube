import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Menu, X, Play } from "lucide-react";

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
      { name: "description", content: "Vidora AI turns a script into a finished, ready-to-upload video: narration, footage, captions, music and motion — generated in one pass." },
      { name: "author", content: "Vidora AI" },
      { property: "og:title", content: "Vidora AI — Your AI video studio, on autopilot" },
      { property: "og:description", content: "Turn a script into a finished, ready-to-upload video in one pass." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@vidoraai" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
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

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </QueryClientProvider>
  );
}

function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const text = size === "sm" ? "text-base" : "text-lg";
  return (
    <span className="flex items-center gap-2">
      <span
        className={`relative flex ${box} items-center justify-center rounded-[10px] bg-foreground`}
      >
        <span className="absolute inset-[3px] rounded-[6px] border border-accent/70" />
        <Aperture className="relative h-3.5 w-3.5 text-accent" strokeWidth={2.4} />
      </span>
      <span className={`font-display ${text} font-700 font-bold tracking-tight text-foreground`}>
        Vidora<span className="text-primary">.ai</span>
      </span>
    </span>
  );
}

function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { label: "Product", to: "/features" },
    { label: "Showcase", to: "/features" },
    { label: "Pricing", to: "/pricing" },
    { label: "Contact", to: "/contact" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full px-3 pt-3 sm:px-6 sm:pt-5">
      <div className="mx-auto flex max-w-5xl items-center justify-between rounded-full border border-border/70 bg-card/80 py-2 pr-2 pl-4 shadow-[0_10px_30px_-24px_oklch(0.235_0.035_196/0.6)] backdrop-blur-xl sm:pl-5">
        <Link to="/" aria-label="Vidora AI home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            to="/contact"
            className="rounded-full px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Log in
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition-transform hover:-translate-y-0.5"
          >
            Start free
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <button
          className="inline-flex items-center justify-center rounded-full p-2 text-foreground md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="mx-auto mt-2 max-w-5xl rounded-3xl border border-border bg-card p-5 shadow-lg md:hidden">
          <nav className="flex flex-col gap-3">
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/pricing"
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-base font-semibold text-background"
              onClick={() => setMobileOpen(false)}
            >
              Start free
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="w-full border-t border-border bg-muted/40 py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          <div className="max-w-xs">
            <Wordmark size="sm" />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Vidora AI is a video studio that runs itself — script in, finished
              cut out, without a timeline in sight.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Product
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <Link to="/features" className="text-sm text-foreground/80 hover:text-primary">
                Features
              </Link>
              <Link to="/pricing" className="text-sm text-foreground/80 hover:text-primary">
                Pricing
              </Link>
              <Link to="/contact" className="text-sm text-foreground/80 hover:text-primary">
                Enterprise
              </Link>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Company
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <a href="mailto:hello@vidora.ai" className="text-sm text-foreground/80 hover:text-primary">
                hello@vidora.ai
              </a>
              <Link to="/contact" className="text-sm text-foreground/80 hover:text-primary">
                Support
              </Link>
              <span className="text-sm text-muted-foreground">Remote · worldwide</span>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Vidora AI. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

