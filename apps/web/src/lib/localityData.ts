import {
  groupIspScores,
  type AggregateRow,
  type ScoredNetwork,
} from './networkScore';
import { findDistrict, findTaluk, slugify } from './slug';

/**
 * Build-time data layer for locality (taluk) pages.
 *
 * A single request to `/v1/aggregate?group=taluk` snapshots every taluk's
 * results; the fetch is memoized so all ~75 statically-generated pages share
 * one network round-trip during `next build`. When the API is unreachable (e.g.
 * a local build without NEXT_PUBLIC_API_WORKER_URL set), we degrade gracefully:
 * every page renders as "needs data" and is marked noindex.
 */

/** Minimum public samples before a page is allowed into the index + sitemap. */
export const INDEX_SAMPLE_THRESHOLD = 5;

export interface TalukAggRow extends AggregateRow {
  taluk?: string | null;
}

export interface MetricSummary {
  samples: number;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
}

export interface TalukData {
  district: string;
  taluk: string;
  districtSlug: string;
  talukSlug: string;
  villages: string[];
  totalSamples: number;
  broadband: MetricSummary;
  mobile: MetricSummary;
  topIsps: ScoredNetwork[];
  indexable: boolean;
}

/** Historical rows stored taluk as "Taluk / Village"; take the taluk segment so
 *  both clean and legacy values slug-match the canonical taluk name. */
export function canonicalTalukName(raw: string): string {
  return raw.split('/')[0].trim();
}

let cachedRows: Promise<TalukAggRow[]> | null = null;

/** Memoized, build-time fetch of every taluk aggregate row. */
export async function getAllTalukAggregates(): Promise<TalukAggRow[]> {
  if (cachedRows) return cachedRows;

  const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
  if (!apiBase) {
    cachedRows = Promise.resolve([]);
    return cachedRows;
  }

  cachedRows = fetch(`${apiBase}/v1/aggregate?group=taluk`)
    .then((r) => (r.ok ? (r.json() as Promise<TalukAggRow[]>) : []))
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch(() => []);

  return cachedRows;
}

function summarize(rows: AggregateRow[]): MetricSummary {
  const samples = rows.reduce((sum, r) => sum + r.sample_count, 0);
  const weighted = (field: keyof AggregateRow): number | null => {
    const usable = rows.filter((r) => typeof r[field] === 'number');
    const weight = usable.reduce((sum, r) => sum + r.sample_count, 0);
    if (!weight) return null;
    return usable.reduce((sum, r) => sum + (r[field] as number) * r.sample_count, 0) / weight;
  };
  return {
    samples,
    downloadMbps: weighted('p50_download_mbps'),
    uploadMbps: weighted('p50_upload_mbps'),
    latencyMs: weighted('p50_latency_ms'),
  };
}

/** Shape one taluk's data for rendering. Returns null for unknown slugs. */
export async function getTalukData(
  districtSlug: string,
  talukSlug: string,
): Promise<TalukData | null> {
  const place = findTaluk(districtSlug, talukSlug);
  if (!place) return null;

  const allRows = await getAllTalukAggregates();
  const rows = allRows.filter(
    (r) =>
      r.district === place.district &&
      r.taluk != null &&
      slugify(canonicalTalukName(r.taluk)) === place.talukSlug,
  );

  const broadband = summarize(rows.filter((r) => r.connection_type === 'wifi' || r.connection_type === 'wired'));
  const mobile = summarize(rows.filter((r) => r.connection_type === 'mobile'));
  const totalSamples = rows.reduce((sum, r) => sum + r.sample_count, 0);
  const topIsps = groupIspScores(rows, 'overall').slice(0, 8);

  return {
    district: place.district,
    taluk: place.taluk,
    districtSlug: place.districtSlug,
    talukSlug: place.talukSlug,
    villages: place.villages,
    totalSamples,
    broadband,
    mobile,
    topIsps,
    indexable: totalSamples >= INDEX_SAMPLE_THRESHOLD,
  };
}

export interface TalukSummary {
  name: string;
  slug: string;
  totalSamples: number;
  downloadMbps: number | null;
}

export interface DistrictData {
  district: string;
  districtSlug: string;
  taluks: TalukSummary[];
  totalSamples: number;
}

/** Shape a district hub: every taluk with its headline number. */
export async function getDistrictData(districtSlug: string): Promise<DistrictData | null> {
  const place = findDistrict(districtSlug);
  if (!place) return null;

  const allRows = await getAllTalukAggregates();
  const taluks: TalukSummary[] = place.taluks.map((taluk) => {
    const slug = slugify(taluk);
    const rows = allRows.filter(
      (r) => r.district === place.district && r.taluk != null && slugify(canonicalTalukName(r.taluk)) === slug,
    );
    const summary = summarize(rows);
    return { name: taluk, slug, totalSamples: summary.samples, downloadMbps: summary.downloadMbps };
  });

  return {
    district: place.district,
    districtSlug,
    taluks: taluks.sort((a, b) => b.totalSamples - a.totalSamples || a.name.localeCompare(b.name)),
    totalSamples: taluks.reduce((sum, t) => sum + t.totalSamples, 0),
  };
}

// ---------------------------------------------------------------------------
// Localized prose + FAQ generation
// ---------------------------------------------------------------------------

/** Deterministic small hash so a place always gets the same template variant. */
function variant(seed: string, count: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % count;
}

const fmt = (v: number | null, unit: string): string =>
  v == null ? '—' : `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${unit}`;

/** Unique, data-driven intro paragraph. Template varies by place to reduce the
 *  duplicate-content footprint across the ~75 pages. */
export function localizedIntro(data: TalukData): string {
  const { taluk, district, broadband, mobile, totalSamples } = data;
  const bb = fmt(broadband.downloadMbps, 'Mbps');
  const mb = fmt(mobile.downloadMbps, 'Mbps');
  const fastest = data.topIsps[0]?.name;

  if (totalSamples < INDEX_SAMPLE_THRESHOLD) {
    return `Internet speed data for ${taluk}, ${district} is still being collected. Run a free speed test from ${taluk} to be among the first to put your area's broadband and mobile network performance on the map.`;
  }

  const templates = [
    `Across ${totalSamples} crowdsourced tests in ${taluk}, ${district}, fixed broadband connections record a typical download of ${bb} while mobile data averages ${mb}. ${fastest ? `${fastest} currently leads local results.` : ''}`,
    `In ${taluk} (${district} district), netundo users measured a median fixed-broadband download of ${bb} and mobile-data download of ${mb} across ${totalSamples} real-world tests. ${fastest ? `The strongest performer so far is ${fastest}.` : ''}`,
    `${taluk}'s internet, based on ${totalSamples} community speed tests in ${district}: broadband lands around ${bb} and mobile data around ${mb}. ${fastest ? `${fastest} tops the local provider rankings.` : ''}`,
  ];
  return templates[variant(`${district}-${taluk}`, templates.length)].trim();
}

export interface FaqItem {
  question: string;
  answer: string;
}

/** Data-driven FAQ for the page and its FAQPage JSON-LD. */
export function localizedFaq(data: TalukData): FaqItem[] {
  const { taluk, broadband, mobile, topIsps, totalSamples } = data;
  const faqs: FaqItem[] = [];
  const fastest = topIsps[0];

  if (fastest) {
    faqs.push({
      question: `Which is the fastest internet provider in ${taluk}?`,
      answer: `Based on ${totalSamples} community speed tests, ${fastest.name} currently records the best overall results in ${taluk}${
        fastest.downloadMbps != null ? `, with a typical download of ${fmt(fastest.downloadMbps, 'Mbps')}` : ''
      }.`,
    });
  }

  faqs.push({
    question: `What is the average broadband speed in ${taluk}?`,
    answer:
      broadband.downloadMbps != null
        ? `Fixed broadband in ${taluk} averages ${fmt(broadband.downloadMbps, 'Mbps')} download and ${fmt(broadband.uploadMbps, 'Mbps')} upload, with around ${fmt(broadband.latencyMs, 'ms')} latency, across ${broadband.samples} tests.`
        : `There isn't enough broadband data for ${taluk} yet. Run a test to help build the local average.`,
  });

  faqs.push({
    question: `How fast is mobile data in ${taluk}?`,
    answer:
      mobile.downloadMbps != null
        ? `Mobile data in ${taluk} averages ${fmt(mobile.downloadMbps, 'Mbps')} download across ${mobile.samples} tests on carriers like Jio, Airtel, Vi and BSNL.`
        : `Mobile-data results for ${taluk} are still being gathered. Run a test on your phone to contribute.`,
  });

  return faqs;
}
