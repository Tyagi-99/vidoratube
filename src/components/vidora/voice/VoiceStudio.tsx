/**
 * F17 Voice Studio — studio UI (Stream D, Phase 3).
 *
 * EXTENDS the existing voiceover mode (Mode 2 dialog): a multi-provider
 * voice library (builtin catalog read-only + user voices) and a text→speech
 * panel wired to the fallback chain (ElevenLabs → OpenAI TTS → gateway).
 *
 * States: loading / empty / error / disabled / unconfigured are all
 * rendered honestly. Provider badges reflect real env-key presence; with
 * no TTS provider configured the synthesize panel is disabled with the
 * "not connected" message.
 */
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AudioLines,
  CheckCircle2,
  Download,
  Loader2,
  Mic,
  Play,
  Plus,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getTtsProviderStatus,
  listVoiceLibrary,
  listVoiceLanguages,
  createUserVoice,
  deleteUserVoice,
  runVoiceoverJob,
} from "@/lib/creation/voice/voice.functions";
import {
  providerLabel,
  VOICE_UPLOAD_ALLOWED_MIME,
  VOICE_UPLOAD_MAX_BYTES,
} from "@/lib/creation/voice/library.server";
import type { VoiceLibraryEntry } from "@/lib/creation/voice/types";

function ProviderBadges({
  providers,
}: {
  providers: { id: string; label: string; configured: boolean; role: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((p) => (
        <Badge key={p.id} variant={p.configured ? "default" : "secondary"} className="gap-1">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${p.configured ? "bg-emerald-400" : "bg-muted-foreground"}`}
          />
          {p.label}
          <span className="opacity-60">· {p.role}</span>
        </Badge>
      ))}
    </div>
  );
}

function VoiceRow({
  voice,
  onDelete,
  deleting,
}: {
  voice: VoiceLibraryEntry;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{voice.name}</span>
          {voice.readOnly && (
            <Badge variant="outline" className="text-xs">
              built-in
            </Badge>
          )}
          {voice.voiceType === "cloned" && (
            <Badge variant="outline" className="text-xs">
              cloned{voice.isCloneLegal ? "" : " · legal pending"}
            </Badge>
          )}
          {voice.voiceType === "uploaded" && (
            <Badge variant="outline" className="text-xs">
              uploaded sample
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{providerLabel(voice.provider)}</span>
          {voice.languageCode && <span>· {voice.languageCode}</span>}
          {voice.verified ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> verified
            </span>
          ) : (
            <span>unverified</span>
          )}
        </div>
      </div>
      {!voice.readOnly && (
        <Button
          variant="ghost"
          size="icon"
          disabled={deleting}
          onClick={() => onDelete(voice.id)}
          aria-label={`Delete ${voice.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function AddVoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"assign" | "upload" | "clone">("assign");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"elevenlabs" | "openai" | "gateway">("elevenlabs");
  const [providerVoiceId, setProviderVoiceId] = useState("");
  const [languageCode, setLanguageCode] = useState("");
  const [isCloneLegal, setIsCloneLegal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const languagesQuery = useQuery({
    queryKey: ["voice-languages"],
    queryFn: () => listVoiceLanguages(),
    enabled: open,
  });
  const createFn = useServerFn(createUserVoice);

  const reset = () => {
    setName("");
    setProvider("elevenlabs");
    setProviderVoiceId("");
    setLanguageCode("");
    setIsCloneLegal(false);
    setFile(null);
    setError(null);
    setBusy(false);
  };

  const onSubmit = async () => {
    if (!user) {
      setError("Sign in to add a voice.");
      return;
    }
    if (!name.trim()) {
      setError("Give the voice a name.");
      return;
    }
    if (mode === "clone" && !isCloneLegal) {
      setError("Voice cloning requires your explicit legal confirmation below.");
      return;
    }
    if (mode === "clone" && !providerVoiceId.trim()) {
      setError("Paste the provider's voice id for the clone (from your ElevenLabs dashboard).");
      return;
    }
    if (mode === "upload" && !file) {
      setError("Choose an audio sample to upload.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      let storagePath: string | undefined;
      let sampleMimeType: string | undefined;
      let sampleBytes: number | undefined;
      if (mode === "upload" && file) {
        if (!(VOICE_UPLOAD_ALLOWED_MIME as readonly string[]).includes(file.type)) {
          throw new Error(
            `Unsupported audio type "${file.type}". Use MP3, WAV, OGG, WebM, or M4A.`,
          );
        }
        if (file.size > VOICE_UPLOAD_MAX_BYTES) {
          throw new Error("Audio is over the 25 MB voice-sample limit.");
        }
        const voiceId = crypto.randomUUID();
        const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
        storagePath = `${user.id}/voices/${voiceId}/sample.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("generated-videos")
          .upload(storagePath, file, { contentType: file.type, upsert: true });
        if (upErr) throw new Error(upErr.message);
        sampleMimeType = file.type;
        sampleBytes = file.size;
      }
      await createFn({
        data: {
          name: name.trim(),
          provider: mode === "upload" ? "upload" : provider,
          providerVoiceId:
            mode === "assign" ? providerVoiceId.trim() || null : providerVoiceId.trim() || null,
          voiceType: mode === "upload" ? "uploaded" : mode === "clone" ? "cloned" : "builtin",
          languageCode: languageCode || null,
          isCloneLegal: mode === "clone" ? isCloneLegal : false,
          storagePath: storagePath ?? null,
          sampleMimeType: sampleMimeType ?? null,
          sampleBytes: sampleBytes ?? null,
        },
      });
      toast.success("Voice added");
      queryClient.invalidateQueries({ queryKey: ["voice-library"] });
      onOpenChange(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the voice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a voice</DialogTitle>
          <DialogDescription>
            Assign a provider voice, upload your own sample, or register a legal clone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="assign">Assign</TabsTrigger>
              <TabsTrigger value="upload">Upload</TabsTrigger>
              <TabsTrigger value="clone">Clone</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-2">
            <Label htmlFor="voice-name">Name</Label>
            <Input
              id="voice-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Documentary narrator"
              maxLength={80}
            />
          </div>
          {mode !== "upload" && (
            <div className="space-y-2">
              <Label htmlFor="voice-provider">Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
                <SelectTrigger id="voice-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                  <SelectItem value="openai">OpenAI TTS</SelectItem>
                  <SelectItem value="gateway">Lovable AI gateway</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {mode !== "upload" && (
            <div className="space-y-2">
              <Label htmlFor="voice-provider-id">
                Provider voice id {mode === "assign" ? "(optional)" : "(required)"}
              </Label>
              <Input
                id="voice-provider-id"
                value={providerVoiceId}
                onChange={(e) => setProviderVoiceId(e.target.value)}
                placeholder={provider === "openai" ? "e.g. nova" : "e.g. 21m00Tcm4TlvDq8ikWAM"}
                maxLength={200}
              />
            </div>
          )}
          {mode === "upload" && (
            <div className="space-y-2">
              <Label>Audio sample (MP3/WAV/OGG/WebM/M4A, max 25 MB)</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()} type="button">
                  <Upload className="mr-2 h-4 w-4" />
                  {file ? file.name : "Choose file"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={VOICE_UPLOAD_ALLOWED_MIME.join(",")}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The sample is validated server-side (type, size, audio header) before the voice is
                saved.
              </p>
            </div>
          )}
          {mode === "clone" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="clone-legal"
                  checked={isCloneLegal}
                  onCheckedChange={(v) => setIsCloneLegal(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="clone-legal" className="font-medium">
                    I confirm I have the legal right to clone this voice
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Cloning someone else's voice without consent may be illegal. The server blocks
                    cloning unless this box is checked.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="voice-language">Language (optional)</Label>
            <Select
              value={languageCode || "__none"}
              onValueChange={(v) => setLanguageCode(v === "__none" ? "" : v)}
            >
              <SelectTrigger id="voice-language">
                <SelectValue placeholder="Pick a language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No language set</SelectItem>
                {(languagesQuery.data ?? []).map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.name_en}
                    {l.name_native && l.name_native !== l.name_en ? ` · ${l.name_native}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add voice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextToSpeechPanel({
  voices,
  providerStatus,
}: {
  voices: VoiceLibraryEntry[];
  providerStatus: { id: string; label: string; configured: boolean; role: string }[] | undefined;
}) {
  const { user } = useSession();
  const [voiceId, setVoiceId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    audioUrl: string;
    durationSeconds: number;
    provider: string;
    model: string | null;
    characters: number;
  } | null>(null);

  const runFn = useServerFn(runVoiceoverJob);
  const anyConfigured = providerStatus?.some((p) => p.configured) ?? false;
  const synthesizable = voices.filter(
    (v) =>
      v.voiceType !== "uploaded" &&
      v.provider !== "none" &&
      !(v.voiceType === "cloned" && !v.isCloneLegal),
  );

  const onRun = async () => {
    if (!user) {
      setError("Sign in to synthesize narration.");
      return;
    }
    if (!voiceId) {
      setError("Pick a voice first.");
      return;
    }
    if (!text.trim()) {
      setError("Enter the narration text.");
      return;
    }
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await runFn({ data: { voiceId, text: text.trim() } });
      if (!res.ok) {
        const codeCopy: Record<string, string> = {
          INSUFFICIENT_CREDITS: "Not enough credits for this narration.",
          BUDGET_EXCEEDED: "This would exceed your workspace/project budget.",
          UNKNOWN_COST: "This voice can't be priced upfront — refusing to run blind.",
          NO_TTS_PROVIDER: "No TTS provider is configured.",
          JOB_IN_PROGRESS: "Already processing — retry in a moment to pick up the finished audio.",
        };
        setError(`${codeCopy[res.code] ?? "Synthesis failed."} ${res.message}`);
        return;
      }
      setResult(res);
      toast.success(`Narration ready — ${res.provider}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Synthesis failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="h-5 w-5" /> Text to speech
        </CardTitle>
        <CardDescription>
          Synthesize narration through the fallback chain (ElevenLabs → OpenAI TTS → gateway).
          Credit preflight runs before any provider is called.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!anyConfigured && (
          <Alert>
            <AlertDescription>
              No TTS provider is connected. Connect ElevenLabs or OpenAI in Settings → Providers to
              synthesize narration.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tts-voice">Voice</Label>
            <Select value={voiceId} onValueChange={setVoiceId} disabled={!anyConfigured}>
              <SelectTrigger id="tts-voice">
                <SelectValue placeholder="Pick a voice" />
              </SelectTrigger>
              <SelectContent>
                {synthesizable.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} · {providerLabel(v.provider)}
                    {v.readOnly ? " (built-in)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {synthesizable.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No synthesizable voices yet — add one in the Library tab.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tts-text">Narration ({text.length}/4000)</Label>
            <Textarea
              id="tts-text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 4000))}
              placeholder="Paste the script for this narration…"
              rows={5}
              disabled={!anyConfigured}
            />
          </div>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button onClick={onRun} disabled={busy || !anyConfigured || !voiceId || !text.trim()}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Synthesize
        </Button>
        {result && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>
                {result.provider}
                {result.model ? ` · ${result.model}` : ""}
              </Badge>
              <span className="text-muted-foreground">
                {result.characters} chars · ~{result.durationSeconds}s
              </span>
            </div>
            <audio controls src={result.audioUrl} className="w-full" preload="metadata" />
            <Button variant="outline" asChild>
              <a href={result.audioUrl} download={`narration-${Date.now()}.mp3`}>
                <Download className="mr-2 h-4 w-4" /> Download MP3
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VoiceStudio() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["tts-provider-status"],
    queryFn: () => getTtsProviderStatus(),
  });
  const libraryQuery = useQuery({
    queryKey: ["voice-library"],
    queryFn: () => listVoiceLibrary(),
  });

  const deleteFn = useServerFn(deleteUserVoice);
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      setDeletingId(id);
      try {
        return await deleteFn({ data: { id } });
      } finally {
        setDeletingId(null);
      }
    },
    onSuccess: () => {
      toast.success("Voice deleted");
      queryClient.invalidateQueries({ queryKey: ["voice-library"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete the voice."),
  });

  const voices = libraryQuery.data?.voices ?? [];
  const builtins = voices.filter((v) => v.readOnly);
  const userVoices = voices.filter((v) => !v.readOnly);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <AudioLines className="h-6 w-6" /> Voice Studio
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your voice library and multi-provider text-to-speech — ElevenLabs first, OpenAI TTS as
          fallback, gateway as last resort.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Providers</CardTitle>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <Skeleton className="h-6 w-64" />
          ) : statusQuery.isError ? (
            <p className="text-sm text-destructive">Could not load provider status.</p>
          ) : (
            <ProviderBadges providers={statusQuery.data?.providers ?? []} />
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="tts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tts">Text to speech</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
        </TabsList>

        <TabsContent value="tts">
          <TextToSpeechPanel voices={voices} providerStatus={statusQuery.data?.providers} />
        </TabsContent>

        <TabsContent value="library" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Your voices</h2>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add voice
            </Button>
          </div>
          {libraryQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : libraryQuery.isError ? (
            <Alert variant="destructive">
              <AlertDescription>Could not load your voice library.</AlertDescription>
            </Alert>
          ) : userVoices.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No custom voices yet. Assign a provider voice, upload a sample, or register a legal
                clone.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {userVoices.map((v) => (
                <VoiceRow
                  key={v.id}
                  voice={v}
                  deleting={deletingId === v.id}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))}
            </div>
          )}

          <h2 className="pt-2 text-lg font-medium">Built-in catalog</h2>
          <p className="text-sm text-muted-foreground">
            Shared reference voices — read-only, managed by Vidora.
          </p>
          {libraryQuery.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : builtins.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No built-in voices for your filters yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {builtins.map((v) => (
                <VoiceRow key={v.id} voice={v} deleting={false} onDelete={() => {}} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AddVoiceDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
