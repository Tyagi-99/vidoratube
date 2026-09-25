import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, FlaskConical } from "lucide-react";
import {
  createClientChannel,
  deleteClientChannel,
  listClientChannels,
} from "@/lib/agency/agency.functions";
import { PLATFORM_VALUES } from "@/lib/agency/agency";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ChannelManager({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listClientChannels);
  const createFn = useServerFn(createClientChannel);
  const deleteFn = useServerFn(deleteClientChannel);
  const [platform, setPlatform] = useState<string>("youtube");
  const [handle, setHandle] = useState("");
  const [isTest, setIsTest] = useState(false);

  const key = ["agency-channels", workspaceId];
  const list = useQuery({ queryKey: key, queryFn: () => listFn({ data: { workspaceId } }) });

  const create = useMutation({
    mutationFn: () =>
      createFn({ data: { workspaceId, platform: platform as never, handle: handle.trim(), isTestChannel: isTest } }),
    onSuccess: () => {
      toast.success("Channel added");
      setHandle("");
      setIsTest(false);
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add channel"),
  });

  const remove = useMutation({
    mutationFn: (channelId: string) => deleteFn({ data: { workspaceId, channelId } }),
    onSuccess: () => {
      toast.success("Channel removed");
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove channel"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Client channels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-36">
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_VALUES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              className="min-w-48 flex-1"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle or channel name"
              maxLength={120}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={isTest} onCheckedChange={(v) => setIsTest(v === true)} />
              <span className="flex items-center gap-1">
                <FlaskConical className="size-3.5" /> Test channel
              </span>
            </label>
            <Button onClick={() => create.mutate()} disabled={create.isPending || handle.trim().length === 0}>
              <Plus className="mr-1 size-4" /> Add
            </Button>
          </div>
        )}
        {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <ul className="divide-y divide-border">
          {list.data?.channels.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{c.platform}</Badge>
                <span className="text-sm">{c.handle}</span>
                {c.is_test_channel && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <FlaskConical className="size-3" /> test
                  </Badge>
                )}
              </div>
              {canEdit && (
                <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)} aria-label="Remove channel">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
          {list.data?.channels.length === 0 && (
            <li className="py-4 text-sm text-muted-foreground">No channels linked yet.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
