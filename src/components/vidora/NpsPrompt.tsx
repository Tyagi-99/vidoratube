/**
 * Sprint 7-8: in-app NPS prompt. Shows only when shouldPromptNps says so.
 * One tap on 0-10, optional comment, stored via submitNps. Dismissible —
 * declining to answer is a valid choice and never blocks the app.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { shouldPromptNps, submitNps } from "@/lib/video-insights.functions";

export function NpsPrompt(props: {
  question: string;
  commentPlaceholder: string;
  submitLabel: string;
  thanksLabel: string;
  dismissLabel: string;
  errorLabel: string;
}) {
  const { question, commentPlaceholder, submitLabel, thanksLabel, dismissLabel, errorLabel } = props;
  const queryClient = useQueryClient();
  const checkFn = useServerFn(shouldPromptNps);
  const submitFn = useServerFn(submitNps);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);

  const check = useQuery({ queryKey: ["nps-prompt"], queryFn: () => checkFn({ data: {} }) });
  const submit = useMutation({
    mutationFn: () => submitFn({ data: { score: score!, comment: comment || undefined } }),
    onSuccess: () => {
      setDone(true);
      queryClient.invalidateQueries({ queryKey: ["nps-prompt"] });
    },
  });

  if (check.isLoading || !check.data?.prompt || dismissed) return null;

  return (
    <Card className="relative">
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <CardContent className="py-6">
        {done ? (
          <p className="text-center text-sm text-muted-foreground">{thanksLabel}</p>
        ) : (
          <>
            <p className="text-center text-sm font-medium">{question}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {Array.from({ length: 11 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setScore(i)}
                  className={`h-9 w-9 rounded-lg border text-sm font-medium transition-colors ${
                    score === i
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span>10</span>
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={commentPlaceholder}
              rows={2}
              maxLength={2000}
              className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="mt-3 flex justify-center">
              <Button size="sm" disabled={score == null || submit.isPending} onClick={() => submit.mutate()}>
                {submitLabel}
              </Button>
            </div>
            {submit.isError && (
              <p className="mt-2 text-center text-xs text-destructive">{errorLabel}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
