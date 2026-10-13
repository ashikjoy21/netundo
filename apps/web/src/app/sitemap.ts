import type { MetadataRoute } from 'next';
import { allDistrictParams, allTalukParams, allVillageParams } from '@/lib/slug';
import { getTalukData, getVillageData } from '@/lib/localityData';
import { absoluteUrl } from '@/lib/site';

export const dynamic = 'force-static';

/** Static export sitemap. Lists core pages, all district hubs, and only the
 *  taluk and village pages that have enough data to be indexable (thin pages,
 *  below INDEX_MIN_TESTS, stay out and carry noindex). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPaths = ['/', '/kerala', '/charts', '/test', '/about', '/methodology', '/privacy'];
  const staticEntries: MetadataRoute.Sitemap = staticPaths.map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
  }));

  const districtEntries: MetadataRoute.Sitemap = allDistrictParams().map(({ district }) => ({
    url: absoluteUrl(`/kerala/${district}`),
    lastModified: now,
    changeFrequency: 'weekly',
  }));

  const talukData = await Promise.all(
    allTalukParams().map(async ({ district, taluk }) => ({
      district,
      taluk,
      data: await getTalukData(district, taluk),
    })),
  );

  const talukEntries: MetadataRoute.Sitemap = talukData
    .filter(({ data }) => data?.indexable)
    .map(({ district, taluk }) => ({
      url: absoluteUrl(`/kerala/${district}/${taluk}`),
      lastModified: now,
      changeFrequency: 'daily',
    }));

  const villageData = await Promise.all(
    allVillageParams().map(async (p) => ({ ...p, data: await getVillageData(p.district, p.taluk, p.village) })),
  );
  const villageEntries: MetadataRoute.Sitemap = villageData
    .filter(({ data }) => data?.indexable)
    .map(({ district, taluk, village }) => ({
      url: absoluteUrl(`/kerala/${district}/${taluk}/${village}`),
      lastModified: now,
      changeFrequency: 'daily',
    }));

  return [...staticEntries, ...districtEntries, ...talukEntries, ...villageEntries];
}
