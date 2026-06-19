export default function AboutPage() {
  return (
    <InfoPage
      eyebrow="About netundo"
      title="A public speed map for Kerala."
      intro="netundo helps people compare real-world internet quality across Kerala using crowdsourced speed tests."
    >
      <p>
        Every submitted test adds a signal about provider performance, connection type, district, and optionally a rounded map location. The goal is to make local network quality easier to understand than a statewide or national average.
      </p>
      <p>
        The measurement experience uses Cloudflare&apos;s browser speed test engine. The public rankings and charts are built from anonymized aggregate results collected through netundo.
      </p>
      <p>
        netundo is independent community infrastructure. Results can vary by device, plan, signal strength, time of day, and local congestion.
      </p>
    </InfoPage>
  );
}

function InfoPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cf-orange">{eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-gray-950">{title}</h1>
      <p className="mt-4 text-base leading-7 text-gray-500">{intro}</p>
      <div className="mt-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 text-sm leading-7 text-gray-600 shadow-sm">
        {children}
      </div>
    </div>
  );
}
