'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, LocateFixed, MessageCircle, Smartphone, Wifi, X } from 'lucide-react';
import {
  KERALA_DISTRICTS,
  STATUS_LABELS,
  brandBySlug,
  normalizeOperatorName,
  slugifyPlace,
  outageHeadline,
  statusPath,
  type ConnectionKind,
  type OutageStatusWord,
} from '@netundo/types';
import { keralaTaluksForDistrict, keralaVillagesForTaluk } from '@/lib/keralaPlaces';
import { API_BASE } from '@/lib/api';
import { getClientToken, getSavedArea, getSavedProvider, saveArea, saveProvider, type SavedArea } from '@/lib/clientPrefs';
import { locateArea } from '@/lib/locate';
import { shareOrWhatsapp } from '@/lib/share';
import { ProviderPicker, isChoiceComplete, type ProviderChoice } from '@/components/ProviderPicker';

export interface ReportArea {
  district: string;
  taluk?: string;
  village?: string;
}

const STATUS_ORDER: OutageStatusWord[] = ['down', 'slow', 'dropping'];
const STATUS_STYLE: Record<OutageStatusWord, string> = {
  down: 'bg-red-600 hover:bg-red-700 text-white',
  slow: 'bg-amber-500 hover:bg-amber-600 text-white',
  dropping: 'bg-orange-600 hover:bg-orange-700 text-white',
};

interface SubmitResult {
  reporters: number;
  likelyOutage: boolean;
  deduped: boolean;
}

/**
 * The "Net illa? Report it" form, as a bottom sheet. Built for speed on a
 * phone: area, provider and connection type are prefilled from the page and
 * from the last report, so a repeat reporter only taps a status button.
 */
export default function ReportSheet({ area: pageArea, onClose }: { area?: ReportArea; onClose: () => void }) {
  const [area, setArea] = useState<SavedArea>({ district: '' });
  const [editingArea, setEditingArea] = useState(false);
  const [provider, setProvider] = useState<ProviderChoice>({ reported: '', name: '' });
  const [kind, setKind] = useState<ConnectionKind>('broadband');
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState<OutageStatusWord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(SubmitResult & { status: OutageStatusWord }) | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Prefill once per page area: page area (most specific) → last reported
  // area → nothing. Keyed on the primitive fields so parent re-renders (e.g.
  // the Right now poll) never wipe what the user has typed.
  const pageDistrict = pageArea?.district;
  const pageTaluk = pageArea?.taluk;
  const pageVillage = pageArea?.village;
  useEffect(() => {
    const saved = getSavedArea();
    if (pageDistrict && pageTaluk) {
      setArea({ district: pageDistrict, taluk: pageTaluk, village: pageVillage });
    } else if (saved && (!pageDistrict || saved.district === pageDistrict)) {
      setArea(saved);
    } else if (pageDistrict) {
      setArea({ district: pageDistrict });
    }
    const savedProvider = getSavedProvider();
    if (savedProvider) {
      setProvider({ reported: savedProvider.reported, name: savedProvider.name ?? '' });
      if (savedProvider.kind) setKind(savedProvider.kind);
    }
  }, [pageDistrict, pageTaluk, pageVillage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const areaComplete = Boolean(area.district && area.taluk);
  const ready = areaComplete && isChoiceComplete(provider);
  const showAreaPicker = editingArea || !areaComplete;

  const useLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const found = await locateArea(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
        if (found) {
          setArea({ district: found.district, taluk: found.taluk });
          setEditingArea(true); // let them add a village
        } else {
          setError('Couldn’t match your location to a Kerala taluk — pick it below.');
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };

  async function submit(status: OutageStatusWord) {
    if (!ready || !API_BASE) return;
    setSubmitting(status);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district: area.district,
          taluk: area.taluk,
          village: area.village || undefined,
          provider: { reported: provider.reported, name: provider.name.trim() || undefined },
          kind,
          status,
          comment: comment.trim() || undefined,
          clientToken: getClientToken(),
        }),
      });
      const body = (await res.json()) as SubmitResult & { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Couldn’t send your report. Please try again.');
        return;
      }
      saveArea(area);
      saveProvider({ reported: provider.reported, name: provider.name.trim() || undefined, kind });
      setResult({ ...body, status });
    } catch {
      setError('No connection right now — your report wasn’t sent. Try again when you have signal.');
    } finally {
      setSubmitting(null);
    }
  }

  const providerName = providerDisplayName(provider);
  const place = area.village || area.taluk || area.district;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:rounded-3xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="report-title" className="text-lg font-bold text-gray-950">
              {result ? 'Thanks for reporting' : 'Net illa? Report it'}
            </h2>
            {!result && <p className="text-sm text-gray-500">നെറ്റ് ഇല്ലേ? റിപ്പോർട്ട് ചെയ്യൂ · No login needed</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          <Done
            result={result}
            headline={outageHeadline({
              reporters: result.reporters,
              provider: providerName,
              place: place ?? '',
              status: result.status,
              windowMin: 30,
            })}
            sharePath={statusPath(area.district, area.taluk as string, brandKeyFor(provider), kind)}
            areaHref={areaHref(area)}
            onClose={onClose}
          />
        ) : (
          <div className="space-y-5">
            {/* Area */}
            <section>
              <Label>Where?</Label>
              {!showAreaPicker ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                  <span className="text-sm font-medium text-gray-900">
                    {[area.village, area.taluk, area.district].filter(Boolean).join(', ')}
                  </span>
                  <button type="button" onClick={() => setEditingArea(true)} className="text-sm font-semibold text-cf-orange">
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={useLocation}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                  >
                    {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-cf-orange" />}
                    Use my location (approximate)
                  </button>
                  <AreaSelects area={area} onChange={setArea} />
                </div>
              )}
            </section>

            {/* Provider */}
            <section>
              <Label>Which provider?</Label>
              <ProviderPicker value={provider} onChange={setProvider} id="report-provider" />
            </section>

            {/* Connection type */}
            <section>
              <Label>Connection</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['broadband', 'Home broadband', <Wifi key="w" className="h-4 w-4" />],
                    ['mobile', 'Mobile data', <Smartphone key="m" className="h-4 w-4" />],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setKind(id)}
                    aria-pressed={kind === id}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold ${
                      kind === id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700'
                    }`}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </section>

            {/* Comment (optional) */}
            {showComment ? (
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={140}
                rows={2}
                placeholder="Optional, e.g. ‘down since 7pm’"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-base outline-none focus:border-cf-orange"
              />
            ) : (
              <button type="button" onClick={() => setShowComment(true)} className="text-sm font-medium text-gray-500 underline">
                Add a short comment (optional)
              </button>
            )}

            {/* Status = submit */}
            <section>
              <Label>What’s happening? Tap to report</Label>
              <div className="grid gap-2">
                {STATUS_ORDER.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={!ready || submitting != null}
                    onClick={() => submit(status)}
                    className={`flex items-center justify-between rounded-2xl px-4 py-4 text-left font-bold transition-colors disabled:opacity-40 ${STATUS_STYLE[status]}`}
                  >
                    <span>
                      {STATUS_LABELS[status].en}
                      <span className="ml-2 text-sm font-medium opacity-90">{STATUS_LABELS[status].ml}</span>
                    </span>
                    {submitting === status && <Loader2 className="h-5 w-5 animate-spin" />}
                  </button>
                ))}
              </div>
              {!ready && (
                <p className="mt-2 text-xs text-gray-500">
                  {!areaComplete ? 'Pick your taluk first.' : 'Pick your provider first.'}
                </p>
              )}
            </section>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <p className="text-[11px] leading-4 text-gray-400">
              We store only the area and provider you pick — never your exact location. Reports are anonymous.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Done({
  result,
  headline,
  sharePath,
  areaHref,
  onClose,
}: {
  result: SubmitResult;
  headline: string;
  sharePath: string;
  areaHref: string;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-green-700">
        <Check className="h-4 w-4" /> {result.deduped ? 'Your report was updated.' : 'Report sent.'}
      </p>
      <p className="text-base text-gray-900">{headline}.</p>
      {result.likelyOutage ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">Likely outage — others are seeing it too.</p>
      ) : (
        <p className="text-sm text-gray-500">Share it — once a few neighbours report, it shows as a likely outage.</p>
      )}
      <button
        type="button"
        onClick={() => shareOrWhatsapp(`${headline}. Is it down for you too?`, sharePath)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3.5 font-bold text-white hover:bg-[#1ebe5b]"
      >
        <MessageCircle className="h-5 w-5" /> Share on WhatsApp
      </button>
      <div className="flex gap-2">
        <a href={areaHref} className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-center text-sm font-semibold text-gray-800">
          See area status
        </a>
        <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800">
          Close
        </button>
      </div>
    </div>
  );
}

function AreaSelects({ area, onChange }: { area: SavedArea; onChange: (a: SavedArea) => void }) {
  const taluks = area.district ? keralaTaluksForDistrict(area.district) : [];
  const villages = area.district && area.taluk ? keralaVillagesForTaluk(area.district, area.taluk) : [];
  const cls = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base text-gray-800 outline-none focus:border-cf-orange';
  return (
    <div className="grid gap-2">
      <select aria-label="District" value={area.district} onChange={(e) => onChange({ district: e.target.value })} className={cls}>
        <option value="">District…</option>
        {KERALA_DISTRICTS.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
      <select
        aria-label="Taluk"
        value={area.taluk ?? ''}
        disabled={!area.district}
        onChange={(e) => onChange({ district: area.district, taluk: e.target.value || undefined })}
        className={cls}
      >
        <option value="">Taluk…</option>
        {taluks.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <select
        aria-label="Village (optional)"
        value={area.village ?? ''}
        disabled={!area.taluk}
        onChange={(e) => onChange({ ...area, village: e.target.value || undefined })}
        className={cls}
      >
        <option value="">Village (optional)…</option>
        {villages.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{children}</p>;
}

function brandKeyFor(choice: ProviderChoice): string {
  if (choice.reported === 'lco' || choice.reported === 'other') {
    return `${choice.reported}:${normalizeOperatorName(choice.name)}`;
  }
  return choice.reported;
}

function providerDisplayName(choice: ProviderChoice): string {
  if (choice.reported === 'lco' || choice.reported === 'other') return choice.name.trim() || 'your provider';
  return brandBySlug(choice.reported)?.name ?? choice.reported;
}

function areaHref(area: SavedArea): string {
  const parts = ['/kerala', slugifyPlace(area.district)];
  if (area.taluk) parts.push(slugifyPlace(area.taluk));
  if (area.village) parts.push(slugifyPlace(area.village));
  return `${parts.join('/')}#right-now`;
}
