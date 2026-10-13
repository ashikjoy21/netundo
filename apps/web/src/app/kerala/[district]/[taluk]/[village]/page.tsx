import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Gauge } from 'lucide-react';
import { allVillageParams, findVillage } from '@/lib/slug';
import {
  getDistrictData,
  getMlabForTaluk,
  getTalukData,
  getVillageData,
  localizedFaq,
  localizedIntro,
  type AreaProseInput,
} from '@/lib/localityData';
import { absoluteUrl } from '@/lib/site';
import { Breadcrumbs, type Crumb } from '@/components/locality/Breadcrumbs';
import { SummaryCards } from '@/components/locality/SummaryCards';
import { MlabBenchmark } from '@/components/locality/MlabBenchmark';
import { IspTable } from '@/components/locality/IspTable';
import { Faq } from '@/components/locality/Faq';
import { VillageList } from '@/components/locality/LinkList';
import { LocalityJsonLd } from '@/components/locality/JsonLd';
import { RightNow } from '@/components/outage/RightNow';
import { FallbackNotice } from '@/components/locality/FallbackNotice';

interface PageProps {
  params: Promise<{ district: string; taluk: string; village: string }>;
}

export function generateStaticParams() {
  return allVillageParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { district, taluk, village } = await params;
  const place = findVillage(district, taluk, village);
  if (!place) return {};

  const data = await getVillageData(district, taluk, village);
  const path = `/kerala/${district}/${taluk}/${village}`;
  const title = `Internet Speed & Outages in ${place.village}, ${place.taluk} | netundo`;
  const description = `Is the net down in ${place.village}? Live outage reports, broadband and mobile speed-test results and the best providers in ${place.village}, ${place.taluk} (${place.district}).`;

  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    // Thin pages stay out of the index (and the sitemap) until they have data.
    robots: data?.indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, type: 'article', url: absoluteUrl(path) },
  };
}

export default async function VillagePage({ params }: PageProps) {
  const { district, taluk, village } = await params;
  const data = await getVillageData(district, taluk, village);
  if (!data) notFound();

  // Fallback chain: village → taluk → district → M-Lab reference.
  const talukData = data.totalSamples === 0 ? await getTalukData(district, taluk) : null;
  const districtData =
    data.totalSamples === 0 && (!talukData || talukData.totalSamples === 0) ? await getDistrictData(district) : null;
  const fallback =
    talukData && talukData.totalSamples > 0
      ? { label: `${data.taluk} taluk`, samples: talukData.totalSamples, broadband: talukData.broadband, mobile: talukData.mobile, providers: talukData.providers }
      : districtData && districtData.totalSamples > 0
        ? { label: `${data.district} district`, samples: districtData.totalSamples, broadband: districtData.broadband, mobile: districtData.mobile, providers: districtData.providers }
        : null;
  const mlab = data.totalSamples === 0 && !fallback ? await getMlabForTaluk(data.district, data.taluk) : null;

  const crumbs: Crumb[] = [
    { label: 'Kerala', href: '/kerala' },
    { label: data.district, href: `/kerala/${district}` },
    { label: data.taluk, href: `/kerala/${district}/${taluk}` },
    { label: data.village },
  ];
  const prose: AreaProseInput = {
    name: data.village,
    parent: data.taluk,
    totalSamples: data.totalSamples,
    broadband: data.broadband,
    mobile: data.mobile,
    providers: data.providers,
  };
  const faqs = localizedFaq(prose);
  const shown = fallback ?? data;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <LocalityJsonLd faqs={faqs} crumbs={crumbs} />
      <Breadcrumbs crumbs={crumbs} />

      <header>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          Internet in {data.village}, {data.taluk}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600">{localizedIntro(prose)}</p>
      </header>

      <RightNow district={data.district} taluk={data.taluk} village={data.village} />

      {fallback ? (
        <FallbackNotice>
          No netundo tests from {data.village} yet — showing <strong>{fallback.label}</strong> results ({fallback.samples}{' '}
          tests) until local data comes in.{' '}
          <a href="/test" className="font-semibold underline">Run a test from {data.village}</a>
        </FallbackNotice>
      ) : data.totalSamples === 0 ? (
        <FallbackNotice>
          No netundo tests from {data.village} or {data.taluk} yet.
          {mlab ? ' Independent M-Lab measurements are shown below for reference.' : ''}{' '}
          <a href="/test" className="font-semibold underline">Be the first to test</a>
        </FallbackNotice>
      ) : null}

      <SummaryCards
        broadband={shown.broadband}
        mobile={shown.mobile}
        placeName={fallback ? fallback.label : data.village}
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">
          Best internet providers in {fallback ? fallback.label : data.village}
        </h2>
        <IspTable providers={shown.providers} placeName={fallback ? fallback.label : data.village} />
      </section>

      {mlab && <MlabBenchmark data={mlab} placeName={data.taluk} geoLevel="taluk" />}

      {faqs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Frequently asked questions</h2>
          <Faq items={faqs} />
        </section>
      )}

      <VillageList
        villages={data.siblings}
        placeName={data.taluk}
        baseHref={`/kerala/${district}/${taluk}`}
        title={`Other villages in ${data.taluk}`}
      />

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-cf-orange/20 bg-cf-orange/5 p-6 text-center sm:flex-row sm:text-left">
        <div className="flex-1">
          <p className="font-semibold text-gray-900">Help map {data.village}&apos;s internet</p>
          <p className="mt-0.5 text-sm text-gray-500">Run a free test — every result sharpens these numbers.</p>
        </div>
        <a
          href="/test"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-cf-orange px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cf-orange-dark"
        >
          <Gauge className="h-4 w-4" />
          Run speed test
        </a>
      </div>
    </div>
  );
}
