import { slugify } from '@/lib/slug';

/** Two reusable link blocks for internal linking: villages in this taluk and
 *  neighbouring taluks. Builds the crawl graph and captures village-name search. */

export function VillageList({
  villages,
  placeName,
  baseHref,
  title,
}: {
  villages: string[];
  placeName: string;
  /** e.g. "/kerala/ernakulam/kanayannor"; each village links to baseHref/slug. */
  baseHref: string;
  title?: string;
}) {
  if (villages.length === 0) return null;
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900">{title ?? `Villages in ${placeName}`}</h2>
      <p className="mt-1 text-sm text-gray-500">
        {placeName} covers {villages.length} villages. Pick one for local speeds and live outage reports.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {villages.map((village) => (
          <li key={village}>
            <a
              href={`${baseHref}/${slugify(village)}`}
              className="inline-flex rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-cf-orange hover:text-cf-orange"
            >
              {village}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NearbyTaluks({
  districtSlug,
  taluks,
  districtName,
}: {
  districtSlug: string;
  taluks: Array<{ name: string; slug: string }>;
  districtName: string;
}) {
  if (taluks.length === 0) return null;
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900">Other areas in {districtName}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {taluks.map((taluk) => (
          <li key={taluk.slug}>
            <a
              href={`/kerala/${districtSlug}/${taluk.slug}`}
              className="inline-flex rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-cf-orange hover:text-cf-orange"
            >
              {taluk.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
