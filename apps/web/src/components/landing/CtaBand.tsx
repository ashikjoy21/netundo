import { Gauge } from 'lucide-react';

export function CtaBand() {
  return (
    <section className="px-4 py-12">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-r from-cf-orange to-cf-orange-dark px-6 py-12 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[120%] -translate-x-1/2 rounded-[100%] bg-orange-200/40 blur-3xl"
        />
        <div className="relative">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Help map Kerala&apos;s internet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/85">
            One quick test adds your ISP and district to the map. It takes about 30 seconds.
          </p>
          <a
            href="/test"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-cf-orange-dark shadow-sm transition-transform hover:scale-[1.03]"
          >
            <Gauge className="h-4 w-4" /> Test My Speed
          </a>
        </div>
      </div>
    </section>
  );
}
