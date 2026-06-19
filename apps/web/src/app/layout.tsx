import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

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
    <header className="border-b border-gray-200 bg-white sticky top-0 z-30">
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Speedtest icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-cf-orange">
            <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 12L7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 12l4-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          </svg>
          <a href="/" className="font-bold text-gray-900 text-base">netundo</a>
          <span className="text-gray-300 mx-1">|</span>
          <span className="text-sm text-gray-400">Speed Test</span>
        </div>
        <nav className="flex items-center gap-4">
          <a href="/kerala" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Kerala Map</a>
          <a href="/about" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">About</a>
          <a href="/test" className="rounded-full bg-cf-orange px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-cf-orange-dark">
            Test Speed
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-200 mt-16 py-6 px-4">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        <nav className="flex gap-4 text-sm text-gray-400">
          <a href="/" className="hover:text-gray-600">Home</a>
          <a href="/about" className="hover:text-gray-600">About</a>
          <a href="/privacy" className="hover:text-gray-600">Privacy Policy</a>
          <a href="/methodology" className="hover:text-gray-600">Methodology</a>
        </nav>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Powered by</span>
          <span className="font-semibold text-cf-orange">Cloudflare</span>
          <span>measurement engine · Open source · MIT</span>
        </div>
      </div>
    </footer>
  );
}
