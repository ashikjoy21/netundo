import {
  groupIspScores,
  type AggregateRow,
  type ScoredNetwork,
} from './networkScore';
import { findDistrict, findTaluk, findVillage, slugify } from './slug';
import { FAQ_HEDGE_BELOW, FAQ_MIN_TESTS, INDEX_MIN_TESTS } from './config';

/**
 * Build-time data layer for locality (district / taluk / village) pages.
 *
 * A single request to `/v1/aggregate?by=brand&group=village` snapshots every
 * place's results grouped by provider brand and connection kind; the fetch is
 * memoized so every statically-generated page shares one network round-trip
 * during `next build`. When the API is unreachable (e.g. a local build without
 * NEXT_PUBLIC_API_WORKER_URL set), we degrade gracefully: every page renders as
 * "needs data" and is marked noindex.
 */

/** Minimum public samples before a page is allowed into the index + sitemap. */
export const INDEX_SAMPLE_THRESHOLD = INDEX_MIN_TESTS;

/** Aggregate row with its place normalised to canonical taluk/village names. */
export interface AreaAggRow extends AggregateRow {
  taluk: string | null;
  village: string | null;
}

export interface MetricSummary {
  samples: number;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
}

export interface ProvidersByKind {
  broadband: ScoredNetwork[];
  mobile: ScoredNetwork[];
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
  providers: ProvidersByKind;
  indexable: boolean;
}

/** Historical rows stored taluk as "Taluk / Village"; take the taluk segment so
 *  both clean and legacy values slug-match the canonical taluk name. */
export function canonicalTalukName(raw: string): string {
  return raw.split('/')[0].trim();
}

/** Split a legacy "Taluk / Village" value into its parts. */
function normalizePlace(row: AggregateRow): AreaAggRow {
  const raw = row.taluk ?? null;
  if (!raw) return { ...row, taluk: null, village: row.village ?? null };
  const [taluk, legacyVillage] = raw.split('/').map((part) => part.trim());
  return { ...row, taluk: taluk || null, village: row.village ?? (legacyVillage || null) };
}

let cachedRows: Promise<AreaAggRow[]> | null = null;

/** Memoized, build-time fetch of every place's brand aggregates (all-time). */
export async function getAllAreaAggregates(): Promise<AreaAggRow[]> {
  if (cachedRows) return cachedRows;

  const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
  if (!apiBase) {
    cachedRows = Promise.resolve([]);
    return cachedRows;
  }

  cachedRows = fetch(`${apiBase}/v1/aggregate?by=brand&group=village&period=all`)
    .then((r) => (r.ok ? (r.json() as Promise<AggregateRow[]>) : []))
    .then((rows) => (Array.isArray(rows) ? rows.map(normalizePlace) : []))
    .catch(() => []);

  return cachedRows;
}

/** Rows for a district, optionally narrowed to a taluk (and village). Matching
 *  is by slug so spelling/case drift in stored names still lines up. */
export async function getAreaRows(
  district: string,
  talukSlug?: string,
  villageSlug?: string,
): Promise<AreaAggRow[]> {
  const rows = await getAllAreaAggregates();
  return rows.filter(
    (r) =>
      r.district === district &&
      (talukSlug == null || (r.taluk != null && slugify(r.taluk) === talukSlug)) &&
      (villageSlug == null || (r.village != null && slugify(r.village) === villageSlug)),
  );
}

/** Ranked providers for each kind. Broadband and mobile are never mixed. */
export function providersByKind(rows: AggregateRow[], limit = 8): ProvidersByKind {
  return {
    broadband: groupIspScores(rows.filter((r) => r.kind === 'broadband'), 'overall').slice(0, limit),
    mobile: groupIspScores(rows.filter((r) => r.kind === 'mobile'), 'overall').slice(0, limit),
  };
}

// ---------------------------------------------------------------------------
// TRAI MySpeed official benchmark (third-party reference, mobile-only, Kerala-wide)
// ---------------------------------------------------------------------------

interface TraiApiRow {
  period: string;
  operator: string;
  technology: string;
  direction: string;
  avg_mbps: number;
}

interface TraiApiResponse {
  period: string | null;
  source: string | null;
  operators: TraiApiRow[];
}

export interface TraiOperator {
  operator: string;
  technology: string;
  downloadMbps: number | null;
  uploadMbps: number | null;
}

export interface TraiBenchmark {
  /** Dataset month, formatted for display (e.g. "May 2026"). */
  periodLabel: string;
  source: string;
  operators: TraiOperator[];
  /** Mean download across operators — the headline Kerala mobile baseline. */
  avgDownloadMbps: number | null;
}

let cachedTrai: Promise<TraiBenchmark | null> | null = null;

/** Memoized, build-time fetch of the latest TRAI Kerala mobile baseline. */
export async function getTraiBenchmark(): Promise<TraiBenchmark | null> {
  if (cachedTrai) return cachedTrai;

  const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
  if (!apiBase) {
    cachedTrai = Promise.resolve(null);
    return cachedTrai;
  }

  cachedTrai = fetch(`${apiBase}/v1/trai`)
    .then((r) => (r.ok ? (r.json() as Promise<TraiApiResponse>) : null))
    .then((res) => (res && res.period ? shapeTrai(res) : null))
    .catch(() => null);

  return cachedTrai;
}

function shapeTrai(res: TraiApiResponse): TraiBenchmark | null {
  // Group rows by operator, keeping the most-sampled download/upload per operator.
  // We prefer the fastest available technology row (4G/5G) by taking the max avg.
  const byOperator = new Map<string, TraiOperator>();
  for (const row of res.operators) {
    const entry = byOperator.get(row.operator) ?? {
      operator: row.operator,
      technology: row.technology,
      downloadMbps: null,
      uploadMbps: null,
    };
    if (row.direction === 'download') {
      if (entry.downloadMbps == null || row.avg_mbps > entry.downloadMbps) {
        entry.downloadMbps = row.avg_mbps;
        entry.technology = row.technology;
      }
    } else if (row.direction === 'upload') {
      if (entry.uploadMbps == null || row.avg_mbps > entry.uploadMbps) {
        entry.uploadMbps = row.avg_mbps;
      }
    }
    byOperator.set(row.operator, entry);
  }

  const operators = [...byOperator.values()]
    .filter((o) => o.downloadMbps != null)
    .sort((a, b) => (b.downloadMbps ?? 0) - (a.downloadMbps ?? 0));

  if (operators.length === 0) return null;

  const dls = operators.map((o) => o.downloadMbps as number);
  const avgDownloadMbps = dls.reduce((s, v) => s + v, 0) / dls.length;

  // res.period is YYYY-MM-01; render as "Month YYYY".
  const d = new Date(res.period as string);
  const periodLabel = Number.isNaN(d.getTime())
    ? (res.period as string)
    : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return {
    periodLabel,
    source: res.source ?? 'TRAI MySpeed (data.gov.in)',
    operators,
    avgDownloadMbps,
  };
}

// ---------------------------------------------------------------------------
// M-Lab independent benchmark (third-party CC0, town-level, latest ~2024)
// ---------------------------------------------------------------------------

interface MlabApiRow {
  geo_level: 'district' | 'taluk';
  district: string;
  taluk: string | null;
  mlab_locality: string;
  match_type: 'exact' | 'alias' | 'hq_town';
  period: string;
  download_mbps: number | null;
  upload_mbps: number | null;
  latency_ms: number | null;
  sample_count: number | null;
  source: string;
}

export interface MlabBenchmark {
  mlabLocality: string;
  matchType: 'exact' | 'alias' | 'hq_town';
  /** Year of the data, e.g. "2024". */
  periodLabel: string;
  source: string;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  sampleCount: number;
}

let cachedMlab: Promise<MlabApiRow[]> | null = null;

async function getAllMlab(): Promise<MlabApiRow[]> {
  if (cachedMlab) return cachedMlab;
  const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
  if (!apiBase) {
    cachedMlab = Promise.resolve([]);
    return cachedMlab;
  }
  cachedMlab = fetch(`${apiBase}/v1/mlab`)
    .then((r) => (r.ok ? (r.json() as Promise<MlabApiRow[]>) : []))
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch(() => []);
  return cachedMlab;
}

function shapeMlab(row: MlabApiRow | undefined): MlabBenchmark | null {
  if (!row || row.download_mbps == null) return null;
  return {
    mlabLocality: row.mlab_locality,
    matchType: row.match_type,
    periodLabel: row.period?.slice(0, 4) ?? '',
    source: row.source,
    downloadMbps: row.download_mbps,
    uploadMbps: row.upload_mbps,
    latencyMs: row.latency_ms,
    sampleCount: row.sample_count ?? 0,
  };
}

/** M-Lab benchmark for a district page (its principal city). */
export async function getMlabForDistrict(district: string): Promise<MlabBenchmark | null> {
  const rows = await getAllMlab();
  return shapeMlab(rows.find((r) => r.geo_level === 'district' && r.district === district));
}

/** M-Lab benchmark for a taluk page (exact/alias/hq-town locality). */
export async function getMlabForTaluk(district: string, taluk: string): Promise<MlabBenchmark | null> {
  const rows = await getAllMlab();
  return shapeMlab(
    rows.find((r) => r.geo_level === 'taluk' && r.district === district && r.taluk === taluk),
  );
}

// ---------------------------------------------------------------------------
// Ookla Open Data benchmark (CC BY-NC-SA, 610m tiles, fixed + mobile, current)
// ---------------------------------------------------------------------------

interface OoklaApiRow {
  geo_level: 'district' | 'taluk';
  district: string;
  taluk: string | null;
  conn_type: 'fixed' | 'mobile';
  period: string;
  download_mbps: number | null;
  upload_mbps: number | null;
  latency_ms: number | null;
  tests: number | null;
  source: string;
}

export interface OoklaMetric {
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  tests: number;
}

export interface OoklaBenchmark {
  period: string; // e.g. "2025-Q3"
  source: string;
  fixed: OoklaMetric | null;
  mobile: OoklaMetric | null;
}

let cachedOokla: Promise<OoklaApiRow[]> | null = null;

async function getAllOokla(): Promise<OoklaApiRow[]> {
  if (cachedOokla) return cachedOokla;
  const apiBase = process.env.NEXT_PUBLIC_API_WORKER_URL;
  if (!apiBase) {
    cachedOokla = Promise.resolve([]);
    return cachedOokla;
  }
  cachedOokla = fetch(`${apiBase}/v1/ookla`)
    .then((r) => (r.ok ? (r.json() as Promise<OoklaApiRow[]>) : []))
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch(() => []);
  return cachedOokla;
}

function shapeOokla(rows: OoklaApiRow[]): OoklaBenchmark | null {
  if (!rows.length) return null;
  const pick = (type: 'fixed' | 'mobile'): OoklaMetric | null => {
    const r = rows.find((x) => x.conn_type === type);
    if (!r || r.download_mbps == null) return null;
    return { downloadMbps: r.download_mbps, uploadMbps: r.upload_mbps, latencyMs: r.latency_ms, tests: r.tests ?? 0 };
  };
  return {
    period: rows[0].period,
    source: rows[0].source,
    fixed: pick('fixed'),
    mobile: pick('mobile'),
  };
}

export async function getOoklaForDistrict(district: string): Promise<OoklaBenchmark | null> {
  const rows = await getAllOokla();
  return shapeOokla(rows.filter((r) => r.geo_level === 'district' && r.district === district));
}

export async function getOoklaForTaluk(district: string, taluk: string): Promise<OoklaBenchmark | null> {
  const rows = await getAllOokla();
  return shapeOokla(rows.filter((r) => r.geo_level === 'taluk' && r.district === district && r.taluk === taluk));
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

  const rows = await getAreaRows(place.district, place.talukSlug);
  const totalSamples = rows.reduce((sum, r) => sum + r.sample_count, 0);

  return {
    district: place.district,
    taluk: place.taluk,
    districtSlug: place.districtSlug,
    talukSlug: place.talukSlug,
    villages: place.villages,
    totalSamples,
    broadband: summarize(rows.filter((r) => r.kind === 'broadband')),
    mobile: summarize(rows.filter((r) => r.kind === 'mobile')),
    providers: providersByKind(rows),
    indexable: totalSamples >= INDEX_SAMPLE_THRESHOLD,
  };
}

export interface VillageData {
  district: string;
  taluk: string;
  village: string;
  districtSlug: string;
  talukSlug: string;
  villageSlug: string;
  /** Other villages in the same taluk, for internal links. */
  siblings: string[];
  totalSamples: number;
  broadband: MetricSummary;
  mobile: MetricSummary;
  providers: ProvidersByKind;
  indexable: boolean;
}

/** Shape one village's data for rendering. Returns null for unknown slugs. */
export async function getVillageData(
  districtSlug: string,
  talukSlug: string,
  villageSlug: string,
): Promise<VillageData | null> {
  const place = findVillage(districtSlug, talukSlug, villageSlug);
  if (!place) return null;

  const rows = await getAreaRows(place.district, place.talukSlug, place.villageSlug);
  const totalSamples = rows.reduce((sum, r) => sum + r.sample_count, 0);

  return {
    district: place.district,
    taluk: place.taluk,
    village: place.village,
    districtSlug: place.districtSlug,
    talukSlug: place.talukSlug,
    villageSlug: place.villageSlug,
    siblings: place.villages.filter((v) => v !== place.village),
    totalSamples,
    broadband: summarize(rows.filter((r) => r.kind === 'broadband')),
    mobile: summarize(rows.filter((r) => r.kind === 'mobile')),
    providers: providersByKind(rows),
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
  /** Every test in the district, including ones with no taluk recorded. */
  totalSamples: number;
  broadband: MetricSummary;
  mobile: MetricSummary;
  providers: ProvidersByKind;
}

/** Shape a district hub: every taluk with its headline number, plus district-wide
 *  summaries that also count tests recorded without a taluk. */
export async function getDistrictData(districtSlug: string): Promise<DistrictData | null> {
  const place = findDistrict(districtSlug);
  if (!place) return null;

  const districtRows = await getAreaRows(place.district);
  const taluks: TalukSummary[] = place.taluks.map((taluk) => {
    const slug = slugify(taluk);
    const rows = districtRows.filter((r) => r.taluk != null && slugify(r.taluk) === slug);
    const summary = summarize(rows.filter((r) => r.kind === 'broadband'));
    return {
      name: taluk,
      slug,
      totalSamples: rows.reduce((sum, r) => sum + r.sample_count, 0),
      downloadMbps: summary.downloadMbps,
    };
  });

  return {
    district: place.district,
    districtSlug,
    taluks: taluks.sort((a, b) => b.totalSamples - a.totalSamples || a.name.localeCompare(b.name)),
    totalSamples: districtRows.reduce((sum, r) => sum + r.sample_count, 0),
    broadband: summarize(districtRows.filter((r) => r.kind === 'broadband')),
    mobile: summarize(districtRows.filter((r) => r.kind === 'mobile')),
    providers: providersByKind(districtRows),
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

/** What the prose generators need to know about a place (taluk or village). */
export interface AreaProseInput {
  /** Place the copy is about, e.g. "Kanayannor" or "Kakkanad". */
  name: string;
  /** Parent area for context, e.g. "Ernakulam". */
  parent: string;
  totalSamples: number;
  broadband: MetricSummary;
  mobile: MetricSummary;
  providers: ProvidersByKind;
}

export function proseInputFromTaluk(data: TalukData): AreaProseInput {
  return {
    name: data.taluk,
    parent: data.district,
    totalSamples: data.totalSamples,
    broadband: data.broadband,
    mobile: data.mobile,
    providers: data.providers,
  };
}

/** The leading broadband provider, but only once there is enough broadband
 *  data to name one at all (FAQ_MIN_TESTS). */
function broadbandLeader(input: AreaProseInput): ScoredNetwork | null {
  if (input.broadband.samples < FAQ_MIN_TESTS) return null;
  return input.providers.broadband[0] ?? null;
}

/** True when a "fastest provider" claim must be framed as early data. */
function isEarly(samples: number): boolean {
  return samples < FAQ_HEDGE_BELOW;
}

/** Unique, data-driven intro paragraph. Template varies by place to reduce the
 *  duplicate-content footprint across the area pages. */
export function localizedIntro(input: AreaProseInput): string {
  const { name, parent, broadband, mobile, totalSamples } = input;
  const bb = fmt(broadband.downloadMbps, 'Mbps');
  const mb = fmt(mobile.downloadMbps, 'Mbps');
  const leader = broadbandLeader(input);
  const fastest = leader?.name;
  const early = isEarly(broadband.samples);

  if (totalSamples < INDEX_SAMPLE_THRESHOLD) {
    return `Internet speed data for ${name}, ${parent} is still being collected. Run a free speed test from ${name} to be among the first to put your area's broadband and mobile network performance on the map.`;
  }

  const templates = [
    `Across ${totalSamples} crowdsourced tests in ${name}, ${parent}, home broadband connections record a typical download of ${bb} while mobile data averages ${mb}. ${fastest ? (early ? `On early data, ${fastest} leads local broadband results.` : `${fastest} currently leads local broadband results.`) : ''}`,
    `In ${name} (${parent}), netundo users measured a median home-broadband download of ${bb} and mobile-data download of ${mb} across ${totalSamples} real-world tests. ${fastest ? (early ? `Early data puts ${fastest} ahead on broadband.` : `The strongest broadband provider so far is ${fastest}.`) : ''}`,
    `${name}'s internet, based on ${totalSamples} community speed tests in ${parent}: home broadband lands around ${bb} and mobile data around ${mb}. ${fastest ? (early ? `${fastest} is ahead on broadband in early results.` : `${fastest} tops the local broadband rankings.`) : ''}`,
  ];
  return templates[variant(`${parent}-${name}`, templates.length)].trim();
}

export interface FaqItem {
  question: string;
  answer: string;
}

/** "Fastest provider" FAQ entry for one connection kind. Omitted below
 *  FAQ_MIN_TESTS; hedged as early data below FAQ_HEDGE_BELOW. */
export function fastestFaq(
  name: string,
  leader: ScoredNetwork | undefined,
  summary: MetricSummary,
  label: string,
  noun: string,
): FaqItem | null {
  if (!leader || summary.samples < FAQ_MIN_TESTS) return null;
  const speed = leader.downloadMbps != null ? `, with a typical download of ${fmt(leader.downloadMbps, 'Mbps')}` : '';
  const answer = isEarly(summary.samples)
    ? `Based on early data from ${summary.samples} ${noun} tests, ${leader.name} has recorded the best overall results in ${name} so far${speed}. With this few tests the ranking can easily change — run a test to make it more reliable.`
    : `Based on ${summary.samples} community ${noun} tests, ${leader.name} currently records the best overall results in ${name}${speed}.`;
  return { question: `Which is the fastest ${label} provider in ${name}?`, answer };
}

/** Data-driven FAQ for the page and its FAQPage JSON-LD. Broadband and mobile
 *  are always answered separately. */
export function localizedFaq(input: AreaProseInput): FaqItem[] {
  const { name, broadband, mobile, providers } = input;
  const faqs: FaqItem[] = [];

  const bbFastest = fastestFaq(name, providers.broadband[0], broadband, 'home broadband', 'broadband');
  if (bbFastest) faqs.push(bbFastest);

  faqs.push({
    question: `What is the average broadband speed in ${name}?`,
    answer:
      broadband.downloadMbps != null
        ? `Home broadband (Wi-Fi and wired) in ${name} averages ${fmt(broadband.downloadMbps, 'Mbps')} download and ${fmt(broadband.uploadMbps, 'Mbps')} upload, with around ${fmt(broadband.latencyMs, 'ms')} latency, across ${broadband.samples} tests.`
        : `There isn't enough home broadband data for ${name} yet. Run a test to help build the local average.`,
  });

  const mobileFastest = fastestFaq(name, providers.mobile[0], mobile, 'mobile data', 'mobile');
  if (mobileFastest) faqs.push(mobileFastest);

  faqs.push({
    question: `How fast is mobile data in ${name}?`,
    answer:
      mobile.downloadMbps != null
        ? `Mobile data in ${name} averages ${fmt(mobile.downloadMbps, 'Mbps')} download across ${mobile.samples} tests on carriers like Jio, Airtel, Vi and BSNL.`
        : `Mobile-data results for ${name} are still being gathered. Run a test on your phone to contribute.`,
  });

  return faqs;
}
