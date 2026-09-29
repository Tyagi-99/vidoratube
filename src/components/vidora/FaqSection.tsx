import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const faqs = [
  {
    question: "Can I monetize the video?",
    answer:
      "You own the script. Quick-path visuals are AI-generated stills, not a licensed stock library. Check YouTube and your local rules before you run ads. We do not promise Partner revenue.",
  },
  {
    question: "What do I need besides a script?",
    answer:
      "A free account and one credit. Paste the script, pick a voice and a format, then keep the tab open until the MP4 is ready.",
  },
  {
    question: "How long does a render take?",
    answer:
      "Short scripts are usually a few minutes. The last step muxes the MP4 in this browser tab, so leaving or closing it can stall the job.",
  },
  {
    question: "Where do footage and music come from?",
    answer:
      "Quick generate uses AI scene stills plus narration. Studio projects can pull stock when Pexels or Pixabay keys are set. Music is optional and only included if you attach a track.",
  },
  {
    question: "Can I use my own footage or voice?",
    answer:
      "Yes. Voiceover mode is for a clip you own plus commentary. Automatic edit trims a raw take. Declare rights before we will render a final.",
  },
  {
    question: "Which languages are supported?",
    answer:
      "Narration is available in English, Hindi, Spanish, and German today — 10 built-in voices per language, plus more from the connected voice library. More languages are in Beta and ship from November 2026.",
  },
];

export function FaqSection() {
  // FAQPage structured data: mirrors the visible questions/answers 1:1 and is
  // server-rendered with the page (never client-only), so crawlers see it in
  // the initial HTML.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  return (
    <section className="w-full bg-background py-20 sm:py-24">
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:px-8">
        <div>
          <p className="mb-3 text-xs font-semibold text-accent">Questions</p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Answered before you ask
          </h2>
          <p className="mt-4 text-muted-foreground">
            Still stuck? Write to hello@vidora.ai and a human replies within a business day.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full border-t border-border">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`} className="border-b border-border">
              <AccordionTrigger className="min-h-14 py-5 text-left text-base font-semibold text-foreground hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-base leading-relaxed text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
