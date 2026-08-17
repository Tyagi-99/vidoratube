const results = [
  { views: "2.5M views", earnings: "$16,952", image: "https://gomotionai.com/dassets/results/r1.png" },
  { views: "234K views", earnings: "$978", image: "https://gomotionai.com/dassets/results/r4.png" },
  { views: "778K views", earnings: "€2,369", image: "https://gomotionai.com/dassets/results/r9.png" },
  { views: "Partner", earnings: "YouTube Partner", image: "https://gomotionai.com/dassets/results/r8.png" },
  { views: "602K views", earnings: "$1,606", image: "https://gomotionai.com/dassets/results/r5.png" },
  { views: "1.6M views", earnings: "$9,163", image: "https://gomotionai.com/dassets/results/r10.png" },
  { views: "3.9M views", earnings: "$25,231", image: "https://gomotionai.com/dassets/results/r2.png" },
  { views: "309K views", earnings: "$1,622", image: "https://gomotionai.com/dassets/results/r7.png" },
  { views: "842K views", earnings: "$6,143", image: "https://gomotionai.com/dassets/results/r3.png" },
];

export function ResultsSection() {
  return (
    <section className="w-full bg-background py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">
            Results
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Real channels. Real money.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Faceless channels that run on one click per video.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {results.map((result, index) => (
            <div
              key={index}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
            >
              <img
                src={result.image}
                alt={`YouTube result: ${result.views} ${result.earnings}`}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/70 via-transparent to-transparent p-3 text-center opacity-0 transition-opacity group-hover:opacity-100">
                <p className="text-xs font-semibold text-white">{result.views}</p>
                <p className="text-xs text-white/90">{result.earnings}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
