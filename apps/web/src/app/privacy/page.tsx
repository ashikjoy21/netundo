export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cf-orange">Privacy</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-gray-950">Privacy-first public measurements.</h1>
      <p className="mt-4 text-base leading-7 text-gray-500">
        netundo collects only what is needed to show Kerala network quality responsibly.
      </p>

      <section className="mt-8 space-y-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm leading-7 text-gray-600 shadow-sm">
        <div>
          <h2 className="font-semibold text-gray-950">What we store</h2>
          <p className="mt-2">
            Speed metrics, connection type, district, optional taluk/village fallback, ISP/ASN detected at the edge, Cloudflare edge location, and browser/device context needed for measurement quality.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-gray-950">Location handling</h2>
          <p className="mt-2">
            GPS results are rounded before storage and used for live map pins. Manual fallback results store only district plus taluk/village text and do not create a precise map pin.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-gray-950">IP handling</h2>
          <p className="mt-2">
            IP addresses are used to detect ISP/ASN and rate-limit abuse. Stored IP references are hashed rather than kept as plain IP addresses.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-gray-950">Public data</h2>
          <p className="mt-2">
            Public views show aggregate speed, latency, ISP, district, connection type, and rounded map points where available. They are not intended to identify individual users.
          </p>
        </div>
      </section>
    </main>
  );
}
