/** Two reusable link blocks for internal linking: villages in this taluk and
 *  neighbouring taluks. Builds the crawl graph and captures village-name search. */

export function VillageList({ villages, placeName }: { villages: string[]; placeName: string }) {
  if (villages.length === 0) return null;
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900">Villages in {placeName}</h2>
      <p className="mt-1 text-sm text-gray-500">
        {placeName} covers {villages.length} villages. Speed-test coverage for each will appear here as data grows.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {villages.map((village) => (
          <li
            key={village}
            className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600"
          >
            {village}
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
