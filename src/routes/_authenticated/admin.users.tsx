import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  adminListUsers,
  adminAdjustCredits,
  adminSetUserStatus,
  adminSetUserRole,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(adminListUsers);
  const creditFn = useServerFn(adminAdjustCredits);
  const statusFn = useServerFn(adminSetUserStatus);
  const roleFn = useServerFn(adminSetUserRole);

  const [search, setSearch] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => listFn({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  const credits = useMutation({
    mutationFn: (vars: { userId: string; delta: number }) =>
      creditFn({ data: { ...vars, reason: "Admin adjustment" } }),
    onSuccess: () => {
      toast.success("Credits updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = useMutation({
    mutationFn: (vars: { userId: string; status: "active" | "suspended" }) =>
      statusFn({ data: vars }),
    onSuccess: () => {
      toast.success("Account updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const role = useMutation({
    mutationFn: (vars: { userId: string; makeAdmin: boolean }) => roleFn({ data: vars }),
    onSuccess: () => {
      toast.success("Role updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = (users.data ?? []).filter((u) =>
    `${u.email ?? ""} ${u.display_name ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Adjust credits, suspend accounts and grant admin access.
      </p>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email or name"
        className="mt-6 max-w-sm"
      />

      {users.isLoading ? (
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      ) : (
        <div className="mt-6 space-y-3">
          {filtered.map((user) => (
            <div key={user.id} className="surface-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">
                    {user.display_name ?? "Unnamed"}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{user.credits} credits</Badge>
                    <Badge variant="secondary" className="capitalize">
                      {user.plan}
                    </Badge>
                    <Badge
                      variant={user.status === "active" ? "secondary" : "destructive"}
                      className="capitalize"
                    >
                      {user.status}
                    </Badge>
                    {user.roles.includes("admin") && <Badge>Admin</Badge>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={amounts[user.id] ?? "10"}
                      onChange={(e) => setAmounts({ ...amounts, [user.id]: e.target.value })}
                      className="w-20"
                      aria-label={`Credit amount for ${user.email}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        credits.mutate({
                          userId: user.id,
                          delta: Number(amounts[user.id] ?? 10),
                        })
                      }
                    >
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        credits.mutate({
                          userId: user.id,
                          delta: -Number(amounts[user.id] ?? 10),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Admin
                    <Switch
                      checked={user.roles.includes("admin")}
                      onCheckedChange={(checked) =>
                        role.mutate({ userId: user.id, makeAdmin: checked })
                      }
                    />
                  </label>

                  <Button
                    size="sm"
                    variant={user.status === "active" ? "outline" : "default"}
                    onClick={() =>
                      status.mutate({
                        userId: user.id,
                        status: user.status === "active" ? "suspended" : "active",
                      })
                    }
                  >
                    {user.status === "active" ? "Suspend" : "Reactivate"}
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-muted-foreground">No users match that search.</p>
          )}
        </div>
      )}
    </div>
  );
}
