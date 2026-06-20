import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Gauge } from 'lucide-react';
import {
  allTalukParams,
  findTaluk,
  siblingTaluks,
} from '@/lib/slug';
import {
  getTalukData,
  getTraiBenchmark,
  localizedFaq,
  localizedIntro,
} from '@/lib/localityData';
import { absoluteUrl } from '@/lib/site';
import { Breadcrumbs, type Crumb } from '@/components/locality/Breadcrumbs';
import { SummaryCards } from '@/components/locality/SummaryCards';
import { TraiBenchmark } from '@/components/locality/TraiBenchmark';
import { IspTable } from '@/components/locality/IspTable';
import { Faq } from '@/components/locality/Faq';
import { VillageList, NearbyTaluks } from '@/components/locality/LinkList';
import { LocalityJsonLd } from '@/components/locality/JsonLd';

interface PageProps {
  params: Promise<{ district: string; taluk: string }>;
}

export function generateStaticParams() {
  return allTalukParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { district, taluk } = await params;
  const place = findTaluk(district, taluk);
  if (!place) return {};

  const data = await getTalukData(district, taluk);
  const path = `/kerala/${district}/${taluk}`;
  const title = `Broadband & Mobile Internet Speed in ${place.taluk}, ${place.district} | netundo`;
  const bb = data?.broadband.downloadMbps;
  const description = bb != null
    ? `Real speed-test results for ${place.taluk}, ${place.district}: typical broadband ${bb.toFixed(0)} Mbps plus mobile data and the best internet providers, from crowdsourced netundo tests.`
    : `Compare broadband and mobile internet speeds in ${place.taluk}, ${place.district}. Crowdsourced speed-test results and the best providers, updated as new tests arrive.`;

  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    robots: data?.indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, type: 'article', url: absoluteUrl(path) },
  };
}

export default async function TalukPage({ params }: PageProps) {
  const { district, taluk } = await params;
  const place = findTaluk(district, taluk);
  if (!place) notFound();

  const data = await getTalukData(district, taluk);
  if (!data) notFound();

  const trai = await getTraiBenchmark();

  const crumbs: Crumb[] = [
    { label: 'Kerala', href: '/kerala' },
    { label: place.district, href: `/kerala/${district}` },
    { label: place.taluk },
  ];
  const faqs = localizedFaq(data);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <LocalityJsonLd faqs={faqs} crumbs={crumbs} />
      <Breadcrumbs crumbs={crumbs} />

      <header>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          Internet speed in {place.taluk}, {place.district}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600">{localizedIntro(data)}</p>
      </header>

      <SummaryCards broadband={data.broadband} mobile={data.mobile} placeName={place.taluk} />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Best internet providers in {place.taluk}</h2>
        <IspTable isps={data.topIsps} placeName={place.taluk} />
      </section>

      {trai && <TraiBenchmark data={trai} />}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Frequently asked questions</h2>
        <Faq items={faqs} />
      </section>

      <VillageList villages={place.villages} placeName={place.taluk} />
      <NearbyTaluks
        districtSlug={district}
        districtName={place.district}
        taluks={siblingTaluks(district, taluk)}
      />

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-cf-orange/20 bg-cf-orange/5 p-6 text-center sm:flex-row sm:text-left">
        <div className="flex-1">
          <p className="font-semibold text-gray-900">Help map {place.taluk}&apos;s internet</p>
          <p className="mt-0.5 text-sm text-gray-500">
            Run a free test from {place.taluk} — every result sharpens these numbers.
          </p>
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
