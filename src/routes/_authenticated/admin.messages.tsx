import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { adminListMessages, adminSetMessageHandled } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/messages")({
  component: AdminMessagesPage,
});

function AdminMessagesPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListMessages);
  const handleFn = useServerFn(adminSetMessageHandled);

  const messages = useQuery({ queryKey: ["admin", "messages"], queryFn: () => listFn({}) });

  const mark = useMutation({
    mutationFn: (vars: { id: string; handled: boolean }) => handleFn({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (messages.isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Inbox</h1>
      <p className="mt-1 text-sm text-muted-foreground">Messages sent from the contact page.</p>

      <div className="mt-6 space-y-4">
        {(messages.data ?? []).map((message) => (
          <div key={message.id} className="surface-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-foreground">{message.name}</p>
                  <Badge variant={message.handled ? "secondary" : "default"}>
                    {message.handled ? "Handled" : "New"}
                  </Badge>
                </div>
                <a
                  href={`mailto:${message.email}`}
                  className="text-sm text-primary hover:underline"
                >
                  {message.email}
                </a>
                {message.subject && (
                  <p className="mt-1 text-sm font-medium text-foreground">{message.subject}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {new Date(message.created_at).toLocaleString()}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mark.mutate({ id: message.id, handled: !message.handled })}
                >
                  {message.handled ? "Reopen" : "Mark handled"}
                </Button>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {message.message}
            </p>
          </div>
        ))}
        {(messages.data ?? []).length === 0 && (
          <p className="py-12 text-center text-muted-foreground">No messages yet.</p>
        )}
      </div>
    </div>
  );
}
