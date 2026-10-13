'use client';

import { LCO_SLUG, OTHER_SLUG, PICKER_BRANDS } from '@netundo/types';

export interface ProviderChoice {
  reported: string;
  name: string;
}

/** "Who's your provider?" select + free-text name for LCO / Other. Shared by the
 *  post-test question and the outage report form. */
export function ProviderPicker({
  value,
  onChange,
  id = 'provider',
}: {
  value: ProviderChoice;
  onChange: (value: ProviderChoice) => void;
  id?: string;
}) {
  const needsName = value.reported === LCO_SLUG || value.reported === OTHER_SLUG;
  return (
    <div className="space-y-2">
      <select
        id={id}
        value={value.reported}
        onChange={(e) => onChange({ reported: e.target.value, name: value.name })}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-base text-gray-800 outline-none focus:border-cf-orange"
      >
        <option value="">Choose your provider…</option>
        {PICKER_BRANDS.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.name}
            {b.nameMl ? ` · ${b.nameMl}` : ''}
          </option>
        ))}
        <option value={LCO_SLUG}>Local cable operator · ലോക്കൽ കേബിൾ</option>
        <option value={OTHER_SLUG}>Other</option>
      </select>
      {needsName && (
        <input
          value={value.name}
          onChange={(e) => onChange({ reported: value.reported, name: e.target.value })}
          maxLength={60}
          placeholder={value.reported === LCO_SLUG ? 'Cable operator name, e.g. Sree Cable Network' : 'Provider name'}
          className="w-full rounded-xl border border-gray-200 px-3 py-3 text-base outline-none focus:border-cf-orange"
          aria-label="Provider name"
        />
      )}
    </div>
  );
}

export function isChoiceComplete(choice: ProviderChoice): boolean {
  if (!choice.reported) return false;
  if (choice.reported === LCO_SLUG || choice.reported === OTHER_SLUG) return choice.name.trim().length > 0;
  return true;
}
