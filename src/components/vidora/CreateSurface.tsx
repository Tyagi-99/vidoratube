import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Page-first create UI. Dialog is only used when opened from Studio as a modal. */
export function CreateSurface({
  asPage,
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: {
  asPage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  const heading = (
    <>
      {asPage ? (
        <div className="space-y-1.5 text-left">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      ) : (
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
      )}
    </>
  );

  if (asPage) {
    return (
      <div
        className={cn(
          "mx-auto w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-none sm:p-8",
          className,
        )}
      >
        {heading}
        <div className="mt-6">{children}</div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto sm:max-w-2xl", className)}>
        {heading}
        {children}
      </DialogContent>
    </Dialog>
  );
}
