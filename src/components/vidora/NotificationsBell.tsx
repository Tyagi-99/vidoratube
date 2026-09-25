import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listNotifications, markNotificationsRead } from "@/lib/notifications.functions";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Studio header bell: shows unread count, lists recent notifications,
 * marks them read when the panel opens. Render-completion rows land here
 * even when no email provider is configured.
 */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = rows.filter((r) => !r.read_at).length;

  useEffect(() => {
    let cancelled = false;
    listNotifications()
      .then((data) => {
        if (!cancelled) {
          setRows(data as NotificationRow[]);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await markNotificationsRead({ data: { ids: [] } });
        setRows((prev) =>
          prev.map((r) => (r.read_at ? r : { ...r, read_at: new Date().toISOString() })),
        );
      } catch {
        /* badge just stays */
      }
    }
  };

  return (
    <div ref={panelRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="size-11"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Notifications</div>
          <div className="max-h-80 overflow-y-auto">
            {!loaded && <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>}
            {loaded && rows.length === 0 && (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Nothing yet — finished renders will show up here.
              </div>
            )}
            {rows.map((n) => (
              <div
                key={n.id}
                className={`border-b border-border/50 px-4 py-3 last:border-0 ${n.read_at ? "" : "bg-accent/5"}`}
              >
                <div className="text-sm font-medium">{n.title}</div>
                {n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}
                {n.link && (
                  <Link
                    to="/studio"
                    onClick={() => setOpen(false)}
                    className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                  >
                    Open studio
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
