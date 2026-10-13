'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { resolveProvider } from '@netundo/types';
import { getClientToken, getSavedProvider, saveProvider } from '@/lib/clientPrefs';
import { ProviderPicker, isChoiceComplete, type ProviderChoice } from './ProviderPicker';

/**
 * Asked once a test completes. The answer is attached to the stored result
 * (PATCH /v1/results/:id/provider) and remembered for next time, so repeat users
 * confirm with a single tap. The ASN-detected brand is the default suggestion.
 */
export function ProviderQuestion({
  resultId,
  asn,
  ispName,
  connectionType,
}: {
  resultId: string | null;
  asn: number | null;
  ispName: string | null;
  connectionType: string;
}) {
  const [choice, setChoice] = useState<ProviderChoice>({ reported: '', name: '' });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    const saved = getSavedProvider();
    if (saved) {
      setChoice({ reported: saved.reported, name: saved.name ?? '' });
      return;
    }
    const detected = resolveProvider({ asn, ispOrg: ispName, connectionType });
    if (detected.asnBrand) setChoice({ reported: detected.asnBrand, name: '' });
  }, [asn, ispName, connectionType]);

  async function submit() {
    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase || !resultId || !isChoiceComplete(choice)) return;
    setState('saving');
    saveProvider({ reported: choice.reported, name: choice.name.trim() || undefined });
    try {
      const res = await fetch(`${apiBase}/v1/results/${resultId}/provider`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientToken: getClientToken(),
          provider: { reported: choice.reported, name: choice.name.trim() || undefined },
        }),
      });
      setState(res.ok ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'saved') {
    return (
      <section className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800">
        <Check className="h-4 w-4" /> Thanks — your provider was added to this result.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-cf-orange/30 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Who&apos;s your provider?</h2>
      <p className="mt-1 text-sm text-gray-500">
        Helps rank local operators correctly — many cable operators share an upstream network, so we can&apos;t always tell from your IP.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <ProviderPicker value={choice} onChange={setChoice} id="post-test-provider" />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!resultId || !isChoiceComplete(choice) || state === 'saving'}
          className="rounded-xl bg-cf-orange px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-cf-orange-dark disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : 'Confirm'}
        </button>
      </div>
      {state === 'error' && <p className="mt-2 text-xs text-red-600">Couldn&apos;t save that — please try again.</p>}
    </section>
  );
}
