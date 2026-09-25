const outcomes = [
  { title: "History & documentary", detail: "Documentary voice + stills" },
  { title: "Stories & kids (Hindi)", detail: "Bedtime stories, moral tales" },
  { title: "Explainers & education", detail: "Concepts made visual" },
  { title: "Travel & culture", detail: "Places, food, traditions" },
  { title: "Shorts & reels", detail: "30–60s vertical cuts" },
];

export function ResultsSection() {
  return (
    <section className="w-full bg-background py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-xs font-semibold text-accent">
            Built for
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Faceless videos from a script
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            These are the niches the studio is aimed at. We do not publish fake view or revenue
            numbers.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {outcomes.map((item) => (
            <div key={item.title} className="rounded-2xl border border-border bg-card p-6">
              <p className="font-semibold text-foreground">{item.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
