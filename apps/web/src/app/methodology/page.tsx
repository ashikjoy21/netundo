export default function MethodologyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cf-orange">Methodology</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-gray-950">How netundo ranks network quality.</h1>
      <p className="mt-4 text-base leading-7 text-gray-500">
        netundo combines browser speed measurements with Kerala-specific location context to make local network comparisons easier.
      </p>

      <section className="mt-8 space-y-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm leading-7 text-gray-600 shadow-sm">
        <div>
          <h2 className="font-semibold text-gray-950">Measurement engine</h2>
          <p className="mt-2">
            Tests use Cloudflare&apos;s speed test engine in the browser. Download and upload are reported in Mbps, while latency and jitter are reported in milliseconds.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-gray-950">Aggregates</h2>
          <p className="mt-2">
            District and ISP views use public, non-outlier results from recent test windows. Results are grouped by district, ASN/ISP, and connection type.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-gray-950">netundo score</h2>
          <p className="mt-2">
            Top charts use a 0-100 score derived from download, upload, latency, jitter, and sample confidence. Use-case rankings adjust the weights for streaming, gaming, calls, and work-from-home patterns.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-gray-950">Map and fallback data</h2>
          <p className="mt-2">
            GPS submissions appear as rounded live map pins. If browser location is blocked, users can choose district, taluk, and village from an official Kerala village spreadsheet; those results count in aggregates but do not appear as precise pins.
          </p>
        </div>
      </section>
    </main>
  );
}
