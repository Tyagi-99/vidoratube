import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, MessageSquare, Send, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { submitContactMessage } from "@/lib/public.functions";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Vidora" },
      { name: "description", content: "Get in touch for enterprise plans, custom volume, and hands-on onboarding." },
      { property: "og:title", content: "Contact — Vidora" },
      { property: "og:description", content: "Enterprise plans, custom volume, and hands-on onboarding." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const send = useServerFn(submitContactMessage);

  const mutation = useMutation({
    mutationFn: (values: { name: string; email: string; subject: string; message: string }) =>
      send({ data: values }),
    onSuccess: () => setSubmitted(true),
    onError: (error: Error) => toast.error(error.message || "Could not send your message"),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    mutation.mutate({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      subject: String(form.get("company") ?? ""),
      message: String(form.get("message") ?? ""),
    });
  };


  return (
    <main className="min-h-screen bg-background pt-16">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Contact
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Enterprise & large scale. Hundreds of videos a month, multiple channels, custom volume & hands-on onboarding.
          </p>
        </div>

        <div className="grid gap-12 lg:grid-cols-2">
          <div className="space-y-8">
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-foreground">Get in touch</h2>
              <p className="text-muted-foreground">
                Tell us what you're building and we'll find a plan that fits your volume, team size, and workflow.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="border-border bg-card">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Email us</p>
                    <p className="text-sm text-muted-foreground">hello@vidora.ai</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border bg-card">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Chat support</p>
                    <p className="text-sm text-muted-foreground">Available 9am–6pm EST</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-2xl border border-border bg-muted/50 p-6">
              <h3 className="mb-3 text-lg font-semibold text-foreground">Enterprise perks</h3>
              <ul className="space-y-3">
                {[
                  "Custom credit packages",
                  "Dedicated onboarding",
                  "Multiple team seats",
                  "API access",
                  "SLA support",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-foreground">
                    <ArrowRight className="h-4 w-4 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Card className="border-border bg-card">
            <CardContent className="p-6 sm:p-8">
              {submitted ? (
                <div className="text-center py-12">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Send className="h-7 w-7" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">Message sent</h3>
                  <p className="mt-2 text-muted-foreground">
                    We'll get back to you within one business day.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" name="name" placeholder="Your name" maxLength={100} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" name="email" type="email" placeholder="you@company.com" maxLength={255} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">Company / channel</Label>
                    <Input id="company" name="company" placeholder="Acme Inc." maxLength={150} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      name="message"
                      placeholder="Tell us about your volume, channels, and goals..."
                      className="min-h-[140px]"
                      maxLength={2000}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {mutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {mutation.isPending ? "Sending…" : "Send message"}
                  </Button>
                </form>

              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
