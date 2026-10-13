'use client';

import { Smartphone, Wifi } from 'lucide-react';
import type { ConnectionKind } from '@/lib/networkScore';

/** "Home broadband | Mobile data" segmented control. Home broadband first and
 *  default everywhere: most Kerala comparisons people make are fixed-line. */
export function KindToggle({
  value,
  onChange,
}: {
  value: ConnectionKind;
  onChange: (kind: ConnectionKind) => void;
}) {
  const options: Array<{ id: ConnectionKind; label: string; icon: React.ReactNode }> = [
    { id: 'broadband', label: 'Home broadband', icon: <Wifi className="h-4 w-4" /> },
    { id: 'mobile', label: 'Mobile data', icon: <Smartphone className="h-4 w-4" /> },
  ];
  return (
    <div role="tablist" aria-label="Connection type" className="inline-flex rounded-full border border-gray-200 bg-white p-1 shadow-sm">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            value === o.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
