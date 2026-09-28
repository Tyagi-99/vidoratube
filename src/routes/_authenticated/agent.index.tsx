/**
 * Phase 5 Stream A (F10) — Vidora Agent UI.
 * Route: /agent
 *
 * Conversation list + thread. Honest states throughout:
 *   - unconfigured (LOVABLE_API_KEY missing): banner, composer disabled
 *   - INSUFFICIENT_CREDITS / BUDGET_EXCEEDED: error bubble, no fake reply
 *   - provider errors: error bubble
 * Assistant messages carry an "AI analysis" label. A standing notice says the
 * agent creates drafts only and approvals happen in the publish pipeline.
 * No fake-functional buttons: Send calls the real sendAgentMessageFn and
 * renders the real result or the real error.
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Loader2, Plus, Send, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { listWorkspaces } from "@/lib/agency/agency.functions";
import {
  getAgentStatus,
  getAgentThread,
  listAgentConversations,
  sendAgentMessageFn,
} from "@/lib/agent/agent.functions";
import type { AgentMessage } from "@/lib/agent/agent.server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/agent/")({
  head: () => ({ meta: [{ title: "Agent — Vidora" }] }),
  component: AgentPage,
});

function AiAnalysisBadge() {
  return (
    <Badge
      className="bg-violet-500/15 text-violet-600 dark:text-violet-400"
      variant="secondary"
    >
      <Sparkles className="mr-1 size-3" aria-hidden="true" /> AI analysis
    </Badge>
  );
}

function ToolMessageBlock({ message }: { message: AgentMessage }) {
  const calls = message.tool_calls;
  return (
    <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs">
      {calls.map((c) => (
        <div key={c.id} className="flex items-center gap-2 py-0.5">
          <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono">{c.name}</span>
          <Badge variant={c.ok ? "secondary" : "destructive"} className="text-[10px]">
            {c.ok ? "ok" : (c.error_code ?? "error")}
          </Badge>
        </div>
      ))}
      {calls.length === 0 && <span className="text-muted-foreground">tool result</span>}
    </div>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  if (message.role === "tool") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%]">
          <ToolMessageBlock message={message} />
        </div>
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] space-y-1.5 rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-2">
            <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <AiAnalysisBadge />
          </div>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

function errorHint(code: string): string {
  switch (code) {
    case "INSUFFICIENT_CREDITS":
      return "Top up credits on the Billing page, then send again.";
    case "BUDGET_EXCEEDED":
      return "This turn would exceed a workspace/project budget cap. Raise the cap or try a cheaper request.";
    case "unconfigured":
      return "Ask the workspace owner to connect AI (LOVABLE_API_KEY).";
    default:
      return "Try again — if it keeps failing, the error above is the real cause.";
  }
}

function AgentPage() {
  const queryClient = useQueryClient();
  const listWs = useServerFn(listWorkspaces);
  const statusFn = useServerFn(getAgentStatus);
  const listConvsFn = useServerFn(listAgentConversations);
  const threadFn = useServerFn(getAgentThread);
  const sendFn = useServerFn(sendAgentMessageFn);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [turnError, setTurnError] = useState<{ code: string; message: string } | null>(null);
  const [lastEstimate, setLastEstimate] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const workspaces = useQuery({ queryKey: ["agent", "workspaces"], queryFn: () => listWs() });
  const status = useQuery({ queryKey: ["agent", "status"], queryFn: () => statusFn() });

  const wsRows = workspaces.data?.workspaces ?? [];
  const activeWs = wsRows.find((w) => w.id === workspaceId) ?? wsRows[0] ?? null;
  const activeWsId = activeWs?.id ?? null;
  useEffect(() => {
    if (activeWsId && workspaceId !== activeWsId) {
      setWorkspaceId(activeWsId);
      setConversationId(null);
      setTurnError(null);
    }
  }, [activeWsId, workspaceId]);

  const conversations = useQuery({
    queryKey: ["agent", "conversations", activeWsId],
    queryFn: () => listConvsFn({ data: { workspaceId: activeWsId!, limit: 30 } }),
    enabled: !!activeWsId,
  });

  const thread = useQuery({
    queryKey: ["agent", "thread", conversationId],
    queryFn: () => threadFn({ data: { conversationId: conversationId! } }),
    enabled: !!conversationId,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.data?.messages.length]);

  const send = useMutation({
    mutationFn: (text: string) =>
      sendFn({ data: { workspaceId: activeWsId!, conversationId, text } }),
    onSuccess: (result) => {
      setDraft("");
      if (result.ok) {
        setTurnError(null);
        setLastEstimate(result.estimatedCredits);
        setConversationId(result.conversationId);
      } else {
        // Honest error envelope — shown as an error bubble, never a fake reply.
        setTurnError({ code: result.code, message: result.message });
        setLastEstimate(null);
        if (result.conversationId) setConversationId(result.conversationId);
      }
      void queryClient.invalidateQueries({ queryKey: ["agent", "thread", result.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["agent", "conversations", activeWsId] });
    },
    onError: (e) => {
      toast.error("Send failed", { description: e instanceof Error ? e.message : String(e) });
    },
  });

  const configured = status.data?.configured ?? true;
  const messages = thread.data?.messages ?? [];

  const canSend = !!activeWsId && configured && !send.isPending && draft.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask about your channels, projects, and analytics. The agent creates drafts only —
          approvals happen in the publish pipeline.
        </p>
      </div>

      {!configured && status.data && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-600" aria-hidden="true" />
              AI agent not configured
            </CardTitle>
            <CardDescription>
              LOVABLE_API_KEY is missing, so no AI replies can be generated. Ask the workspace
              owner to connect AI. Your messages are still saved to the thread.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        {/* Conversation list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Conversations</CardTitle>
            <div className="pt-1">
              <Select
                value={activeWsId ?? ""}
                onValueChange={(v) => {
                  setWorkspaceId(v);
                  setConversationId(null);
                  setTurnError(null);
                }}
              >
                <SelectTrigger aria-label="Workspace">
                  <SelectValue placeholder="Workspace" />
                </SelectTrigger>
                <SelectContent>
                  {wsRows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setConversationId(null);
                setTurnError(null);
                setLastEstimate(null);
              }}
            >
              <Plus className="mr-1 size-3.5" aria-hidden="true" /> New conversation
            </Button>
            {conversations.isLoading && <Skeleton className="h-10 w-full" />}
            {(conversations.data ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setConversationId(c.id);
                  setTurnError(null);
                }}
                className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-muted ${
                  c.id === conversationId ? "bg-muted font-medium" : ""
                }`}
              >
                {c.title}
              </button>
            ))}
            {conversations.data?.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No conversations yet — start one below.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Thread */}
        <Card className="flex min-h-[480px] flex-col">
          <CardHeader className="border-b pb-3">
            <CardDescription className="text-xs">
              Creates <strong>drafts only</strong> (draft scripts, draft publish jobs). It cannot
              approve, publish, schedule, or spend. Costs shown are <strong>ESTIMATEs</strong>. AI
              prepares, human approves.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 overflow-y-auto py-4">
            {!conversationId && messages.length === 0 && !turnError && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <Bot className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  Ask e.g. “Which of my projects are still drafts?” or “Draft a script about my
                  top-performing topic.” Every factual answer comes from your real data.
                </p>
              </div>
            )}
            {thread.isLoading && (
              <>
                <Skeleton className="h-12 w-3/4" />
                <Skeleton className="h-12 w-2/3 self-end" />
              </>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {turnError && (
              <div className="flex justify-start">
                <div className="max-w-[85%] space-y-1 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2 font-medium text-destructive">
                    <TriangleAlert className="size-4" aria-hidden="true" />
                    {turnError.code === "INSUFFICIENT_CREDITS"
                      ? "Not enough credits"
                      : turnError.code === "BUDGET_EXCEEDED"
                        ? "Budget cap reached"
                        : turnError.code === "unconfigured"
                          ? "AI agent not configured"
                          : "Something went wrong"}
                  </div>
                  <p className="text-muted-foreground">{turnError.message}</p>
                  <p className="text-xs text-muted-foreground">{errorHint(turnError.code)}</p>
                </div>
              </div>
            )}
            {lastEstimate !== null && (
              <p className="text-right text-[11px] text-muted-foreground">
                Last turn cost ESTIMATE: ~{lastEstimate} credit{lastEstimate === 1 ? "" : "s"}
              </p>
            )}
            <div ref={bottomRef} />
          </CardContent>
          <div className="border-t p-3">
            <div className="flex gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canSend) {
                    e.preventDefault();
                    send.mutate(draft.trim());
                  }
                }}
                placeholder={
                  configured ? "Ask the agent…" : "AI is not configured — messaging disabled"
                }
                disabled={!configured || send.isPending || !activeWsId}
                rows={2}
                className="resize-none"
                aria-label="Message the agent"
              />
              <Button
                onClick={() => canSend && send.mutate(draft.trim())}
                disabled={!canSend}
                aria-label="Send message"
              >
                {send.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
