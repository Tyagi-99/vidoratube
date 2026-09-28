/**
 * Phase 6 Stream E (P1) — Watchtower: competitor alerts.
 *
 * Rules that watch the user's own tracked channels and fire a notification
 * plus a draft idea when a breakout video, a title pattern, or a compound
 * growth condition matches. Evaluation is on-demand ("Check now"); the
 * same envelope is cron-ready.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  checkAlertRules,
  createAlertRule,
  deleteAlertRule,
  listAlertRules,
  toggleAlertRule,
  type AlertRuleRow,
} from "@/lib/intelligence/alerts.functions";
import { ALERT_RULE_TYPES, type AlertRuleType } from "@/lib/intelligence/alerts";
import { listChannels } from "@/lib/intelligence/channels.functions";
import { listFolders } from "@/lib/intelligence/folders.functions";

export const Route = createFileRoute("/_authenticated/intelligence/alerts/")({
  component: WatchtowerPage,
});

const TYPE_LABELS: Record<AlertRuleType, string> = {
  breakout_video: "Breakout video",
  title_pattern: "Title pattern",
  growth_condition: "Growth condition",
};

function conditionSummary(rule: AlertRuleRow): string {
  const c = rule.conditions as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : "—");
  switch (rule.rule_type) {
    case "breakout_video":
      return `Outlier ≥ ${num(c["minOutlier"])}× in last ${num(c["lookbackDays"])} days`;
    case "title_pattern":
      return `Title matches /${String(c["pattern"] ?? "")}/ in last ${num(c["lookbackDays"])} days`;
    case "growth_condition":
      return [
        c["minSubscribers"] != null ? `subs ≥ ${num(c["minSubscribers"])}` : null,
        c["minAvgViews"] != null ? `avg views ≥ ${num(c["minAvgViews"])}` : null,
      ]
        .filter(Boolean)
        .join(" AND ");
    default:
      return "";
  }
}

function scopeLabel(rule: AlertRuleRow): string {
  if (rule.channel_id) return "one channel";
  if (rule.folder_id) return "one folder";
  return "all tracked channels";
}

function WatchtowerPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listAlertRules);
  const createFn = useServerFn(createAlertRule);
  const deleteFn = useServerFn(deleteAlertRule);
  const toggleFn = useServerFn(toggleAlertRule);
  const checkFn = useServerFn(checkAlertRules);
  const channelsFn = useServerFn(listChannels);
  const foldersFn = useServerFn(listFolders);

  const rulesQuery = useQuery({ queryKey: ["alert-rules"], queryFn: () => listFn({ data: {} }) });
  const channelsQuery = useQuery({
    queryKey: ["alert-rule-channels"],
    queryFn: () => channelsFn({ data: {} }),
  });
  const foldersQuery = useQuery({
    queryKey: ["alert-rule-folders"],
    queryFn: () => foldersFn({ data: {} }),
  });

  const [showForm, setShowForm] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["alert-rules"] });

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      ruleType: AlertRuleType;
      channelId: string | null;
      folderId: string | null;
      conditions: Record<string, unknown>;
    }) => createFn({ data: input }),
    onSuccess: () => {
      toast.success("Watchtower rule created");
      setShowForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) => deleteFn({ data: { ruleId } }),
    onSuccess: () => {
      toast.success("Rule deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (ruleId: string) => toggleFn({ data: { ruleId } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const check = useMutation({
    mutationFn: () => checkFn({ data: {} }),
    onSuccess: (res) => {
      if (res.status === "no_rules") {
        setLastCheck("No active rules to check. Create a rule below.");
      } else if (res.status === "no_data") {
        setLastCheck(res.reason);
      } else {
        setLastCheck(
          res.fired === 0
            ? `Checked ${res.checked} rule${res.checked === 1 ? "" : "s"} — no new signals.`
            : `${res.fired} new signal${res.fired === 1 ? "" : "s"} delivered to your bell and saved as draft ideas.`,
        );
        if (res.fired > 0) invalidate();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rules = rulesQuery.data?.rules ?? [];
  const channelOptions =
    channelsQuery.data?.status === "ok" ? channelsQuery.data.channels : [];
  const folderOptions =
    foldersQuery.data?.status === "ok" ? foldersQuery.data.folders : [];

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Watchtower</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Rules that watch your tracked channels. A new breakout video, title pattern, or
            growth signal lands in your notifications — and as a draft idea in your backlog.
            Evaluated on demand against your own tracked data; nothing is invented.
          </p>
        </div>
        <Button onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Check now
        </Button>
      </div>

      {lastCheck && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-foreground"
        >
          {lastCheck}
        </div>
      )}

      {rulesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading rules…</p>
      ) : rules.length === 0 && !showForm ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <BellRing className="h-8 w-8 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              No alert rules yet. Watchtower works with your tracked channels — for example,
              "any video over 2× outlier in the last 7 days" or "titles matching 'gave away'".
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create your first rule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{rule.name}</p>
                    <Badge variant="secondary">{TYPE_LABELS[rule.rule_type]}</Badge>
                    <Badge variant="outline">{scopeLabel(rule)}</Badge>
                    {!rule.is_active && <Badge variant="destructive">paused</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {conditionSummary(rule)}
                    {rule.last_fired_at
                      ? ` · last fired ${new Date(rule.last_fired_at).toLocaleString()}`
                      : " · never fired"}
                  </p>
                </div>
                <Switch
                  checked={rule.is_active}
                  onCheckedChange={() => toggle.mutate(rule.id)}
                  aria-label={rule.is_active ? "Pause rule" : "Resume rule"}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove.mutate(rule.id)}
                  disabled={remove.isPending}
                  aria-label={`Delete rule ${rule.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
          {!showForm && (
            <Button variant="outline" onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" /> New rule
            </Button>
          )}
        </div>
      )}

      {showForm && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">New Watchtower rule</CardTitle>
          </CardHeader>
          <CardContent>
            <RuleForm
              channelOptions={channelOptions.map((c) => ({
                id: c.id,
                label: c.title ?? c.handle ?? "Untitled channel",
              }))}
              folderOptions={folderOptions.map((f) => ({ id: f.id, label: f.name }))}
              isPending={create.isPending}
              onCancel={() => setShowForm(false)}
              onSubmit={(input) => create.mutate(input)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RuleForm({
  channelOptions,
  folderOptions,
  isPending,
  onCancel,
  onSubmit,
}: {
  channelOptions: Array<{ id: string; label: string }>;
  folderOptions: Array<{ id: string; label: string }>;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    ruleType: AlertRuleType;
    channelId: string | null;
    folderId: string | null;
    conditions: Record<string, unknown>;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState<AlertRuleType>("breakout_video");
  const [minOutlier, setMinOutlier] = useState("2");
  const [lookbackDays, setLookbackDays] = useState("7");
  const [pattern, setPattern] = useState("");
  const [minSubscribers, setMinSubscribers] = useState("");
  const [minAvgViews, setMinAvgViews] = useState("");
  const [scope, setScope] = useState<"all" | "channel" | "folder">("all");
  const [channelId, setChannelId] = useState("");
  const [folderId, setFolderId] = useState("");

  const submit = () => {
    const conditions: Record<string, unknown> = {};
    if (ruleType === "breakout_video") {
      conditions["minOutlier"] = Number(minOutlier);
      conditions["lookbackDays"] = Number(lookbackDays);
    } else if (ruleType === "title_pattern") {
      conditions["pattern"] = pattern.trim();
      conditions["lookbackDays"] = Number(lookbackDays);
    } else {
      if (minSubscribers.trim()) conditions["minSubscribers"] = Number(minSubscribers);
      if (minAvgViews.trim()) conditions["minAvgViews"] = Number(minAvgViews);
    }
    onSubmit({
      name: name.trim(),
      ruleType,
      channelId: scope === "channel" && channelId ? channelId : null,
      folderId: scope === "folder" && folderId ? folderId : null,
      conditions,
    });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="rule-name">Rule name</Label>
        <Input
          id="rule-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Breakout videos this week"
          maxLength={120}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Rule type</Label>
        <Select value={ruleType} onValueChange={(v) => setRuleType(v as AlertRuleType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALERT_RULE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {ruleType === "breakout_video" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="min-outlier">Outlier multiple ≥ (e.g. 2 = twice the channel median)</Label>
            <Input
              id="min-outlier"
              type="number"
              min={1.2}
              step={0.1}
              value={minOutlier}
              onChange={(e) => setMinOutlier(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lookback">Look back (days)</Label>
            <Input
              id="lookback"
              type="number"
              min={1}
              max={90}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(e.target.value)}
            />
          </div>
        </>
      )}

      {ruleType === "title_pattern" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="pattern">Title pattern (regular expression)</Label>
            <Input
              id="pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. gave away|survived"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lookback-2">Look back (days)</Label>
            <Input
              id="lookback-2"
              type="number"
              min={1}
              max={90}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(e.target.value)}
            />
          </div>
        </>
      )}

      {ruleType === "growth_condition" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="min-subs">Minimum subscribers (optional)</Label>
            <Input
              id="min-subs"
              type="number"
              min={1}
              value={minSubscribers}
              onChange={(e) => setMinSubscribers(e.target.value)}
              placeholder="e.g. 100000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="min-views">Minimum average views (optional)</Label>
            <Input
              id="min-views"
              type="number"
              min={1}
              value={minAvgViews}
              onChange={(e) => setMinAvgViews(e.target.value)}
              placeholder="e.g. 50000"
            />
          </div>
        </>
      )}

      <div className="space-y-1.5 sm:col-span-2">
        <Label>Scope</Label>
        <Select value={scope} onValueChange={(v) => setScope(v as "all" | "channel" | "folder")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tracked channels</SelectItem>
            <SelectItem value="channel" disabled={channelOptions.length === 0}>
              One channel
            </SelectItem>
            <SelectItem value="folder" disabled={folderOptions.length === 0}>
              One folder
            </SelectItem>
          </SelectContent>
        </Select>
        {scope === "channel" && (
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger className="mt-2">
              <SelectValue placeholder="Pick a channel" />
            </SelectTrigger>
            <SelectContent>
              {channelOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {scope === "folder" && (
          <Select value={folderId} onValueChange={setFolderId}>
            <SelectTrigger className="mt-2">
              <SelectValue placeholder="Pick a folder" />
            </SelectTrigger>
            <SelectContent>
              {folderOptions.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending || !name.trim()}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create rule
        </Button>
      </div>
    </div>
  );
}
