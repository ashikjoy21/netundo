import { Gauge, MapPinned, Lock } from 'lucide-react';

const ITEMS = [
  {
    Icon: Gauge,
    title: 'Accurate',
    body: "Runs on Cloudflare's measurement engine — the same one behind speed.cloudflare.com — so your numbers match the real thing.",
  },
  {
    Icon: MapPinned,
    title: 'Local',
    body: 'See genuine speeds for your ISP and district across all 14 districts of Kerala, not a national average.',
  },
  {
    Icon: Lock,
    title: 'Private',
    body: 'District-only by default. Sharing your exact spot on the map is opt-in, and even then it is stored rounded to ~100 m.',
  },
];

export function TrustStrip() {
  return (
    <section>
      <h2 className="text-center text-2xl font-bold text-gray-900">Why netundo</h2>
      <p className="mx-auto mt-1 max-w-xl text-center text-sm text-gray-500">
        Everything you need to understand your connection — and Kerala&apos;s.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {ITEMS.map(({ Icon, title, body }) => (
          <div
            key={title}
            className="rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-sm"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cf-orange/10 text-cf-orange">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-gray-900">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
