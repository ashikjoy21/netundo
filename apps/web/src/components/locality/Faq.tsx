import type { FaqItem } from '@/lib/localityData';

export function Faq({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
      {items.map((item) => (
        <details key={item.question} className="group px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-semibold text-gray-800 marker:hidden">
            <span className="flex items-center justify-between gap-2">
              {item.question}
              <span className="text-gray-300 transition-transform group-open:rotate-45">+</span>
            </span>
          </summary>
          <p className="mt-2 text-sm leading-6 text-gray-600">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
