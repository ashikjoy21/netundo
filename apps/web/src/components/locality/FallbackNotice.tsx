import { Info } from 'lucide-react';

/** Banner shown when a page borrows data from a wider area (or a third-party
 *  dataset) because it has no netundo tests of its own yet. */
export function FallbackNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
