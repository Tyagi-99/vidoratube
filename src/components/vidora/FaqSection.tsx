import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "Can Vidora videos be monetized?",
    answer:
      "Yes. The script is your original content and Vidora produces it with licensed footage and original motion design — which is exactly what platforms pay out on. The channels in our showcase are monetized.",
  },
  {
    question: "What do I need besides a script?",
    answer:
      "Nothing. Paste the script, pick a voice and a visual register, and render. Narration, footage, captions, score and the final export are handled for you.",
  },
  {
    question: "How long does a render take?",
    answer:
      "Most cuts are back within the hour. Longer or denser scripts take a little more, and you can queue several renders at once and come back to them.",
  },
  {
    question: "Where do footage and music come from?",
    answer:
      "Vidora matches clips and tracks from licensed libraries, so everything in the master is safe to publish and monetize.",
  },
  {
    question: "Can I use my own voice?",
    answer:
      "Yes. Upload your narration track and Vidora builds the entire cut around your timing.",
  },
  {
    question: "Which languages are supported?",
    answer:
      "14 languages, each with 100+ studio-grade voices to choose from.",
  },
];

export function FaqSection() {
  return (
    <section className="w-full bg-background py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:px-8">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Questions
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Answered before you ask
          </h2>
          <p className="mt-4 text-muted-foreground">
            Still stuck? Write to hello@vidora.ai and a human replies within a business day.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full border-t border-border">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className="border-b border-border"
            >
              <AccordionTrigger className="py-5 text-left text-base font-semibold text-foreground hover:no-underline">
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
