const results = [
  { views: "2.5M views", earnings: "$16,952", title: "The Forgotten Ship Chase", gradient: "from-blue-600 to-indigo-700" },
  { views: "234K views", earnings: "$978", title: "Ancient Cities of the Sahara", gradient: "from-amber-600 to-orange-700" },
  { views: "778K views", earnings: "€2,369", title: "The Man Who Beat the Banks", gradient: "from-emerald-600 to-teal-700" },
  { views: "Partner", earnings: "YouTube Partner", title: "Space Mysteries", gradient: "from-violet-600 to-purple-700" },
  { views: "602K views", earnings: "$1,606", title: "True Crime: The Heist", gradient: "from-red-600 to-rose-700" },
  { views: "1.6M views", earnings: "$9,163", title: "World War II Untold", gradient: "from-slate-600 to-gray-700" },
  { views: "3.9M views", earnings: "$25,231", title: "Mysteries of the Ocean", gradient: "from-cyan-600 to-blue-700" },
  { views: "309K views", earnings: "$1,622", title: "The Secret Formula", gradient: "from-lime-600 to-green-700" },
  { views: "842K views", earnings: "$6,143", title: "Conspiracy Unpacked", gradient: "from-fuchsia-600 to-pink-700" },
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
              <div className={`relative aspect-[4/3] w-full bg-gradient-to-br ${result.gradient} p-4`}>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="rounded bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm w-fit">
                    YOUTUBE
                  </div>
                  <p className="line-clamp-2 text-sm font-bold leading-tight text-white">
                    {result.title}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">{result.views}</p>
                  <p className="text-xs text-muted-foreground">{result.earnings}</p>
                </div>
                <div className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
                  ▶
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
