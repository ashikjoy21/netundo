'use client';

import { useEffect, useMemo, useState } from 'react';
import { Flag, MessageSquare } from 'lucide-react';
import type { ConnectionKind } from '@netundo/types';
import { API_BASE } from '@/lib/api';
import { getClientToken, getSavedProvider } from '@/lib/clientPrefs';
import { ProviderPicker, isChoiceComplete, type ProviderChoice } from '@/components/ProviderPicker';

interface AreaComment {
  id: string;
  at: string;
  village: string | null;
  brand_key: string;
  provider: string;
  kind: ConnectionKind;
  body: string;
}

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days} d ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}

/**
 * Short provider reviews from people in this area ("stable for 2 years",
 * "drops every evening"), with a provider filter, a post form and a
 * "report comment" button. Loaded client-side; moderation happens server-side.
 */
export function CommunityComments({ district, taluk, village }: { district: string; taluk: string; village?: string }) {
  const [comments, setComments] = useState<AreaComment[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);

  const load = async () => {
    if (!API_BASE) {
      setComments([]);
      return;
    }
    try {
      const params = new URLSearchParams({ district, taluk });
      const res = await fetch(`${API_BASE}/v1/comments?${params}`);
      const body = (await res.json()) as { comments?: AreaComment[] };
      setComments(res.ok ? (body.comments ?? []) : []);
    } catch {
      setComments([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district, taluk]);

  const providers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of comments ?? []) seen.set(c.brand_key, c.provider);
    return [...seen.entries()];
  }, [comments]);

  // Village pages show that village's comments first, then the rest of the taluk.
  const visible = useMemo(() => {
    const list = (comments ?? []).filter((c) => filter === 'all' || c.brand_key === filter);
    return village ? [...list].sort((a, b) => Number(b.village === village) - Number(a.village === village)) : list;
  }, [comments, filter, village]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <MessageSquare className="h-4 w-4 text-gray-400" /> What people in {taluk} say
        </h2>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
        >
          {formOpen ? 'Cancel' : 'Add your experience'}
        </button>
      </div>

      {formOpen && (
        <CommentForm
          district={district}
          taluk={taluk}
          village={village}
          onPosted={() => {
            setFormOpen(false);
            void load();
          }}
        />
      )}

      {providers.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[['all', 'All providers'] as [string, string], ...providers].map(([key, name]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                filter === key ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-600'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {comments == null ? (
        <div className="h-16 animate-pulse rounded-xl bg-gray-100" aria-hidden />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-500">
          No comments yet. How has your provider been in {village ?? taluk}? Share a line to help your neighbours choose.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {visible.map((c) => (
            <CommentRow key={c.id} comment={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentRow({ comment: c }: { comment: AreaComment }) {
  const [reported, setReported] = useState<'idle' | 'sending' | 'done'>('idle');
  const report = async () => {
    if (!API_BASE) return;
    setReported('sending');
    try {
      await fetch(`${API_BASE}/v1/comments/${c.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientToken: getClientToken() }),
      });
    } finally {
      setReported('done');
    }
  };
  return (
    <li className="p-3">
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
        <span className="font-semibold text-gray-900">{c.provider}</span>
        <span>{c.kind === 'broadband' ? 'Home broadband' : 'Mobile data'}</span>
        {c.village && <span>· {c.village}</span>}
        <span>· {timeAgo(c.at)}</span>
      </p>
      <p className="mt-1 text-sm text-gray-800">{c.body}</p>
      <button
        type="button"
        onClick={report}
        disabled={reported !== 'idle'}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 disabled:hover:text-gray-400"
      >
        <Flag className="h-3 w-3" /> {reported === 'done' ? 'Reported — thanks' : 'Report comment'}
      </button>
    </li>
  );
}

function CommentForm({
  district,
  taluk,
  village,
  onPosted,
}: {
  district: string;
  taluk: string;
  village?: string;
  onPosted: () => void;
}) {
  const saved = typeof window !== 'undefined' ? getSavedProvider() : null;
  const [provider, setProvider] = useState<ProviderChoice>({ reported: saved?.reported ?? '', name: saved?.name ?? '' });
  const [kind, setKind] = useState<ConnectionKind>(saved?.kind ?? 'broadband');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'sending'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!API_BASE || !isChoiceComplete(provider) || body.trim().length < 3) return;
    setState('sending');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district,
          taluk,
          village,
          provider: { reported: provider.reported, name: provider.name.trim() || undefined },
          kind,
          body: body.trim(),
          clientToken: getClientToken(),
        }),
      });
      const out = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(out.error ?? 'Couldn’t post that — please try again.');
        return;
      }
      onPosted();
    } catch {
      setError('No connection — your comment wasn’t posted.');
    } finally {
      setState('idle');
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <ProviderPicker value={provider} onChange={setProvider} id="comment-provider" />
      <div className="grid grid-cols-2 gap-2">
        {(['broadband', 'mobile'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold ${kind === k ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700'}`}
          >
            {k === 'broadband' ? 'Home broadband' : 'Mobile data'}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={280}
        rows={3}
        placeholder="e.g. ‘Stable for 2 years’ or ‘drops every evening’"
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-base outline-none focus:border-cf-orange"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-400">{body.length}/280 · no links or phone numbers</span>
        <button
          type="button"
          onClick={submit}
          disabled={state === 'sending' || !isChoiceComplete(provider) || body.trim().length < 3}
          className="rounded-xl bg-cf-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {state === 'sending' ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
