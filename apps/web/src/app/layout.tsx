import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Database, Gauge, MapPin, Radio, Rocket, ShieldCheck, Wifi } from 'lucide-react';
import { KERALA_VILLAGES } from '@/lib/keralaPlaces';
import { slugify } from '@/lib/slug';
import './globals.css';

const KERALA_DISTRICT_NAMES = Object.keys(KERALA_VILLAGES);

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'netundo — Kerala Speed Test',
  description: 'Crowdsourced internet speed test for Kerala. Measure your connection and help map network quality across all 14 districts.',
  openGraph: {
    title: 'netundo — Kerala Speed Test',
    description: 'Test your internet speed and contribute to Kerala\'s network quality map.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-white">
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-3 py-2 sm:h-12 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <a href="/" aria-label="netundo home" className="flex min-w-0 items-center">
            <Wordmark />
          </a>
          <a href="/test" className="shrink-0 rounded-full bg-cf-orange px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cf-orange-dark sm:hidden">
            Test Speed
          </a>
        </div>
        <nav className="flex items-center gap-2 overflow-x-auto pb-0.5 text-sm sm:gap-4 sm:overflow-visible sm:pb-0">
          <a href="/kerala" className="whitespace-nowrap rounded-full bg-gray-50 px-3 py-1.5 font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 sm:bg-transparent sm:px-0 sm:py-0">Kerala Map</a>
          <a href="/charts" className="whitespace-nowrap rounded-full bg-gray-50 px-3 py-1.5 font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 sm:bg-transparent sm:px-0 sm:py-0">Top Charts</a>
          <a href="/test" className="hidden rounded-full bg-cf-orange px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-cf-orange-dark sm:inline-flex">
            Test Speed
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const footerFacts = [
    { icon: <ShieldCheck className="h-4 w-4" />, text: 'Privacy-first crowd data' },
    { icon: <Rocket className="h-4 w-4" />, text: 'Cloudflare measurement engine' },
    { icon: <Database className="h-4 w-4" />, text: 'Open source, MIT licensed' },
    { icon: <Wifi className="h-4 w-4" />, text: 'Mobile and broadband results' },
  ];

  return (
    <footer className="mt-16 px-1 pb-1 sm:px-2">
      <div className="relative mx-auto min-h-[370px] max-w-[1260px] overflow-hidden rounded-[1.35rem] bg-[#ff4f16] text-white shadow-[0_24px_80px_rgba(124,45,18,0.22)]">
        <div
          aria-hidden
          className="footer-glow absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 108%, rgba(255,246,194,0.92) 0, rgba(255,221,130,0.64) 13%, rgba(255,116,31,0.48) 32%, transparent 55%), linear-gradient(180deg, #ff4618 0%, #ff5a1e 48%, #fb6a18 100%)',
          }}
        />
        <div
          aria-hidden
          className="footer-dot-field absolute inset-0 opacity-[0.16] mix-blend-soft-light"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.85) 1px, transparent 1.4px)',
            backgroundSize: '7px 7px',
          }}
        />
        <div aria-hidden className="footer-light-sweep absolute inset-y-0 -left-1/3 w-1/2 bg-white/10 blur-3xl" />
        <div aria-hidden className="footer-orb absolute bottom-[-42px] left-1/2 h-24 w-80 -translate-x-1/2 rounded-[100%] bg-yellow-100/55 blur-2xl" />
        <FloatingTile className="left-[8%] top-16 rotate-[-8deg]" delay="0s" icon={<Radio />} />
        <FloatingTile className="left-[20%] top-8 hidden rotate-[13deg] sm:flex" delay="-2.4s" icon={<Database />} />
        <FloatingTile className="right-[20%] top-10 hidden rotate-[-12deg] sm:flex" delay="-4.1s" icon={<Wifi />} />
        <FloatingTile className="right-[8%] top-20 rotate-[14deg]" delay="-1.2s" icon={<ShieldCheck />} />

        <div className="relative mx-auto flex min-h-[370px] max-w-4xl flex-col items-center justify-center px-6 pb-24 pt-20 text-center">
          <h2 className="footer-copy-reveal max-w-3xl text-balance text-4xl font-semibold tracking-[-0.055em] text-white sm:text-5xl">
            Build Kerala&apos;s public internet map
          </h2>
          <p className="footer-copy-reveal mx-auto mt-6 max-w-xl text-balance text-sm font-medium leading-6 text-white/75 sm:text-base [animation-delay:120ms]">
            Run one quick Cloudflare-powered test and help everyone compare real network quality across districts, providers, and connection types.
          </p>
          <div className="footer-copy-reveal mt-8 flex flex-col items-center gap-3 sm:flex-row [animation-delay:220ms]">
            <a
              href="/test"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-neutral-950 shadow-[0_18px_50px_rgba(154,52,18,0.25)] transition duration-200 hover:-translate-y-0.5 hover:bg-orange-50"
            >
              <Gauge className="h-4 w-4 text-cf-orange transition-transform duration-300 group-hover:rotate-[-12deg]" />
              Test speed for free
            </a>
            <a
              href="/kerala"
              className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold text-white/85 ring-1 ring-white/30 transition duration-200 hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
            >
              <MapPin className="h-4 w-4" />
              View Kerala map
            </a>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 overflow-hidden border-t border-white/15 bg-white/[0.03] py-4 backdrop-blur-sm">
          <div className="footer-marquee flex w-max gap-8 text-xs font-medium text-white/72">
            <div className="flex min-w-max items-center gap-8 px-4">
              {footerFacts.map((fact) => (
                <FooterFact key={fact.text} icon={fact.icon} text={fact.text} />
              ))}
            </div>
            <div aria-hidden className="flex min-w-max items-center gap-8 px-4">
              {footerFacts.map((fact) => (
                <FooterFact key={fact.text} icon={fact.icon} text={fact.text} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="-mx-1 mt-6 border-t border-neutral-800 bg-[#10100f] px-5 py-9 text-white sm:-mx-2 sm:mt-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex max-w-[1260px] flex-col gap-7 md:flex-row md:items-center md:justify-between">
          <div>
            <a href="/" aria-label="netundo home" className="inline-flex items-center">
              <Wordmark inverse size="sm" />
            </a>
            <p className="mt-3 max-w-md text-xs leading-6 text-neutral-400">
              Crowdsourced Kerala network quality data, powered by Cloudflare&apos;s measurement engine.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <a href="/" className="text-neutral-300 transition-colors hover:text-white">Home</a>
            <a href="/test" className="text-neutral-300 transition-colors hover:text-white">Speed Test</a>
            <a href="/kerala" className="text-neutral-300 transition-colors hover:text-white">Kerala Map</a>
            <a href="/charts" className="text-neutral-300 transition-colors hover:text-white">Top Charts</a>
            <a href="/about" className="text-neutral-300 transition-colors hover:text-white">About</a>
            <a href="/methodology" className="text-neutral-300 transition-colors hover:text-white">Methodology</a>
            <a href="/privacy" className="text-neutral-300 transition-colors hover:text-white">Privacy</a>
          </nav>
        </div>
        <div className="mx-auto mt-8 max-w-[1260px] border-t border-white/10 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Internet speed by district
          </p>
          <nav className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
            {KERALA_DISTRICT_NAMES.map((district) => (
              <a
                key={district}
                href={`/kerala/${slugify(district)}`}
                className="text-neutral-300 transition-colors hover:text-cf-orange"
              >
                {district}
              </a>
            ))}
          </nav>
        </div>
        <div className="mx-auto mt-7 flex max-w-[1260px] flex-col gap-2 border-t border-white/10 pt-5 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Open source · MIT · Community data, not an ISP certification.</span>
          <span>© {new Date().getFullYear()} netundo</span>
        </div>
      </div>
    </footer>
  );
}

function Wordmark({ inverse = false, size = 'md' }: { inverse?: boolean; size?: 'sm' | 'md' }) {
  const textSize = size === 'sm' ? 'text-xl' : 'text-2xl sm:text-[1.7rem]';
  const netColor = inverse ? 'text-white' : 'text-[#171d2b]';

  return (
    <span className={`inline-flex items-baseline font-black leading-none tracking-[-0.095em] ${textSize}`}>
      <span className={netColor}>net</span>
      <span className="text-cf-orange">undo</span>
    </span>
  );
}

function FloatingTile({ className, delay, icon }: { className: string; delay: string; icon: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className={`footer-floating-tile absolute flex h-14 w-14 items-center justify-center rounded-xl border border-white/25 bg-white/5 text-white/60 shadow-[0_10px_35px_rgba(124,45,18,0.16)] backdrop-blur-sm ${className}`}
      style={{ animationDelay: delay }}
    >
      <span className="[&>svg]:h-5 [&>svg]:w-5">{icon}</span>
    </div>
  );
}

function FooterFact({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {icon}
      {text}
    </span>
  );
}
