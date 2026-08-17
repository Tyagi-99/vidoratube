import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "Can these videos get monetized?",
    answer:
      "Yes. Your script is original content, and Vidora produces it with real footage and motion graphics. That's what YouTube pays for, and the results above come from monetized channels.",
  },
  {
    question: "What do I need besides the script?",
    answer:
      "Nothing. You paste the script, pick a voice and a format, and click Generate. We handle narration, footage, captions, music, and the final render.",
  },
  {
    question: "How long does a video take?",
    answer:
      "Most videos are ready within the hour. Longer or more complex scripts may take a little more time, but you can queue multiple videos and come back when they're done.",
  },
  {
    question: "Where do the footage and music come from?",
    answer:
      "We match real stock footage and music to your script from licensed libraries, so the final video is safe to publish and monetize on YouTube.",
  },
  {
    question: "Can I use my own voice?",
    answer:
      "Yes. You can upload your own narration, and Vidora will build the rest of the video around it.",
  },
  {
    question: "What languages are supported?",
    answer:
      "Vidora supports 14 languages with 100+ studio-grade voices in each language.",
  },
];

export function FaqSection() {
  return (
    <section className="w-full bg-background py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2 className="mb-10 text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Frequently asked
        </h2>
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`} className="border-b border-border">
              <AccordionTrigger className="py-5 text-left text-lg font-medium text-foreground hover:no-underline">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-base text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
