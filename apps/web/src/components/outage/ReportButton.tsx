'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { WifiOff } from 'lucide-react';
import type { ReportArea } from './ReportSheet';

// The form (and its village list) only loads when someone taps the button,
// so pages stay light on slow connections.
const ReportSheet = dynamic(() => import('./ReportSheet'), { ssr: false });

/** Prominent "Net illa? Report it" button (English + Malayalam). */
export function ReportButton({
  area,
  size = 'lg',
  tone = 'red',
  className = '',
}: {
  area?: ReportArea;
  size?: 'lg' | 'sm';
  /** 'light' for use on coloured backgrounds (homepage hero). */
  tone?: 'red' | 'light';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const sizing =
    size === 'lg'
      ? 'gap-3 rounded-2xl px-5 py-4 text-base'
      : 'gap-2 rounded-full px-3.5 py-1.5 text-sm';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center font-bold shadow-sm transition-colors ${
          tone === 'light' ? 'bg-white text-red-600 hover:bg-red-50' : 'bg-red-600 text-white hover:bg-red-700'
        } ${sizing} ${className}`}
      >
        <WifiOff className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
        <span className="text-left leading-tight">
          Net illa?<span className={size === 'sm' ? 'hidden sm:inline' : ''}> Report it</span>
          {size === 'lg' && <span className="block text-xs font-medium opacity-90">നെറ്റ് ഇല്ലേ? റിപ്പോർട്ട് ചെയ്യൂ</span>}
        </span>
      </button>
      {open && <ReportSheet area={area} onClose={() => setOpen(false)} />}
    </>
  );
}
