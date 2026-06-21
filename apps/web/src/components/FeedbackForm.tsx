'use client';

import { useState } from 'react';
import { Bug, Check, Lightbulb, MapPin, MessageSquare, Send } from 'lucide-react';

type Category = 'bug' | 'feature' | 'data' | 'general';

const CATEGORIES: { value: Category; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: 'bug', label: 'Bug report', hint: 'Something is broken', icon: <Bug className="h-4 w-4" /> },
  { value: 'feature', label: 'Feature idea', hint: 'Something to add', icon: <Lightbulb className="h-4 w-4" /> },
  { value: 'data', label: 'Data correction', hint: 'A number looks wrong', icon: <MapPin className="h-4 w-4" /> },
  { value: 'general', label: 'General', hint: 'Anything else', icon: <MessageSquare className="h-4 w-4" /> },
];

export function FeedbackForm({ districts }: { districts: string[] }) {
  const [category, setCategory] = useState<Category>('general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [district, setDistrict] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 3) {
      setError('Please add a little more detail.');
      return;
    }

    setStatus('submitting');
    setError(null);

    const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
    if (!apiBase) {
      setStatus('error');
      setError('Feedback is not configured yet. Please try again later.');
      return;
    }

    try {
      const res = await fetch(`${apiBase}/v1/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: message.trim(),
          email: email.trim() || undefined,
          district: district || undefined,
          pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || 'Something went wrong.');
      }

      setStatus('done');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  if (status === 'done') {
    return (
      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cf-orange/10 text-cf-orange">
          <Check className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-gray-950">Thanks for the feedback</h2>
        <p className="mt-2 text-sm leading-7 text-gray-500">
          We read every submission. {email.trim() ? 'We’ll reach out if we need more detail.' : 'Add an email next time if you’d like a reply.'}
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus('idle');
            setMessage('');
            setEmail('');
            setDistrict('');
            setCategory('general');
          }}
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      {/* Category */}
      <div>
        <label className="text-sm font-semibold text-gray-900">What kind of feedback is this?</label>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => {
            const active = category === c.value;
            return (
              <button
                type="button"
                key={c.value}
                onClick={() => setCategory(c.value)}
                aria-pressed={active}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  active
                    ? 'border-cf-orange bg-cf-orange/5 ring-1 ring-cf-orange'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className={active ? 'text-cf-orange' : 'text-gray-400'}>{c.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                  <span className="block text-xs text-gray-500">{c.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Message */}
      <div>
        <label htmlFor="fb-message" className="text-sm font-semibold text-gray-900">
          Your message
        </label>
        <textarea
          id="fb-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={4000}
          required
          placeholder="Tell us what happened, what you expected, or what you'd like to see…"
          className="mt-2 w-full resize-y rounded-xl border border-gray-200 px-3.5 py-3 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:border-cf-orange focus:outline-none focus:ring-1 focus:ring-cf-orange"
        />
      </div>

      {/* Optional fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fb-email" className="text-sm font-semibold text-gray-900">
            Email <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            id="fb-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-cf-orange focus:outline-none focus:ring-1 focus:ring-cf-orange"
          />
        </div>
        <div>
          <label htmlFor="fb-district" className="text-sm font-semibold text-gray-900">
            District <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <select
            id="fb-district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:border-cf-orange focus:outline-none focus:ring-1 focus:ring-cf-orange"
          >
            <option value="">Not specific to a district</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs leading-5 text-gray-400">
          We only use your email to follow up. No spam, ever.
        </p>
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-cf-orange px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cf-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {status === 'submitting' ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </form>
  );
}
