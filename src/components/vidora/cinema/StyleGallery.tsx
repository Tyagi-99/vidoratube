const STYLES = [
  { name: "Cinematic", desc: "Anamorphic light, film grain", img: "/styles/style-cinematic.jpg", grade: "from-amber-900/60 via-[#1a1208] to-black" },
  { name: "Documentary", desc: "Natural light, honest", img: "/styles/style-documentary.jpg", grade: "from-stone-700/50 via-[#141210] to-black" },
  { name: "Anime", desc: "Cel-shaded, bold lines", img: "/styles/style-anime.jpg", grade: "from-orange-800/50 via-[#160f08] to-black" },
  { name: "Noir", desc: "Hard shadows, fog", img: "/styles/style-noir.jpg", grade: "from-zinc-700/40 via-[#0e0e10] to-black" },
  { name: "Watercolor", desc: "Soft washes, paper", img: "/styles/style-watercolor.jpg", grade: "from-yellow-800/40 via-[#16120a] to-black" },
  { name: "Pixel", desc: "16-bit, crisp", img: "/styles/style-pixel.jpg", grade: "from-emerald-900/40 via-[#0c1410] to-black" },
];

/** One script, six films: the same projector, rendered in each visual style. */
export function StyleGallery() {
  return (
    <section className="relative border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-2xl">
          <p className="font-mono text-xs tracking-[0.2em] text-[oklch(0.82_0.145_78)]">
            THE LOOK
          </p>
          <h2 className="font-display mt-4 text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Ten ways to look.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            One script, ten different films. Pick a visual style and every scene
            follows it — characters stay consistent throughout.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {STYLES.map((s) => (
            <figure
              key={s.name}
              className="group relative overflow-hidden rounded-lg border border-border"
            >
              <div className={`relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${s.grade}`}>
                <img
                  src={s.img}
                  alt={`A film projector rendered in the ${s.name} visual style`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <div
                  className="pointer-events-none absolute inset-0 opacity-50"
                  style={{
                    background:
                      "radial-gradient(50% 60% at 60% 30%, oklch(0.82 0.145 78 / 0.18), transparent 70%)",
                  }}
                />
              </div>
              <figcaption className="absolute inset-x-0 bottom-0 flex items-baseline justify-between bg-gradient-to-t from-black/80 to-transparent p-4">
                <span className="font-display text-lg font-bold text-white">{s.name}</span>
                <span className="font-mono text-[11px] text-white/60">{s.desc}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          Stills above generated from a single prompt — one script, six films.
          + 4 more in the studio, including a custom style trained on your references.
        </p>
      </div>
    </section>
  );
}
