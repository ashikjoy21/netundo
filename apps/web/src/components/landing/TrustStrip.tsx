import { Lock, MapPinned, Network, RadioTower } from 'lucide-react';

const ITEMS = [
  {
    Icon: RadioTower,
    title: 'Run everywhere',
    body: 'Measure Wi-Fi, mobile data, or wired connections from the places people actually use them: homes, hostels, shops, buses, campuses, and offices.',
  },
  {
    Icon: MapPinned,
    title: 'Compare locally',
    body: 'National averages hide local truth. netundo groups results by district, provider, connection type, and ASN so Kerala can compare networks place by place.',
  },
  {
    Icon: Lock,
    title: 'Contribute privately',
    body: 'District-only by default. Exact map points are opt-in and rounded before storage, so the public dataset helps everyone without exposing your home.',
  },
];

export function TrustStrip() {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-neutral-800 bg-[#10100f] text-white shadow-[0_24px_90px_rgba(0,0,0,0.18)]">
      <div className="relative px-5 py-14 sm:px-8 sm:py-20">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '96px 96px',
          }}
        />

        <div className="relative mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cf-orange/30 bg-cf-orange/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cf-orange-light">
            <Network className="h-3.5 w-3.5" />
            Inspired by Cloudflare&apos;s network view
          </p>
          <h2 className="text-balance text-4xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">
            Region: Kerala
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-sm leading-6 text-neutral-400 sm:text-base">
            Cloudflare shows the Internet as a living network. netundo applies
            that idea locally: every speed test becomes a public signal for
            understanding which providers actually perform in Kerala.
          </p>
        </div>

        <div className="relative mx-auto mt-12 grid max-w-5xl border border-white/10 bg-[#151514]/90 backdrop-blur sm:grid-cols-3">
          {ITEMS.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="border-b border-white/10 p-6 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-sm font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-neutral-400">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
