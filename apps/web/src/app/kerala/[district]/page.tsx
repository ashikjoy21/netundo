import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { allDistrictParams, findDistrict } from '@/lib/slug';
import { getDistrictData } from '@/lib/localityData';
import { absoluteUrl } from '@/lib/site';
import { Breadcrumbs, type Crumb } from '@/components/locality/Breadcrumbs';
import { LocalityJsonLd } from '@/components/locality/JsonLd';

interface PageProps {
  params: Promise<{ district: string }>;
}

export function generateStaticParams() {
  return allDistrictParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { district } = await params;
  const place = findDistrict(district);
  if (!place) return {};

  const path = `/kerala/${district}`;
  const title = `Internet Speed in ${place.district}, Kerala — Broadband & Mobile by Area | netundo`;
  const description = `Compare broadband and mobile internet speeds across ${place.taluks.length} areas in ${place.district}, Kerala, from crowdsourced netundo speed tests.`;
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: { title, description, type: 'website', url: absoluteUrl(path) },
  };
}

export default async function DistrictPage({ params }: PageProps) {
  const { district } = await params;
  const place = findDistrict(district);
  if (!place) notFound();

  const data = await getDistrictData(district);
  if (!data) notFound();

  const crumbs: Crumb[] = [
    { label: 'Kerala', href: '/kerala' },
    { label: place.district },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <LocalityJsonLd faqs={[]} crumbs={crumbs} />
      <Breadcrumbs crumbs={crumbs} />

      <header>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          Internet speed in {place.district}, Kerala
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600">
          Broadband and mobile-data performance across {data.taluks.length} areas in {place.district}, measured by{' '}
          {data.totalSamples} crowdsourced netundo speed tests. Pick an area to see local providers and speeds.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.taluks.map((taluk) => (
          <a
            key={taluk.slug}
            href={`/kerala/${district}/${taluk.slug}`}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm"
          >
            <p className="truncate text-sm font-semibold text-gray-900">{taluk.name}</p>
            <p className="mt-1 text-2xl font-bold text-cf-orange">
              {taluk.downloadMbps != null ? taluk.downloadMbps.toFixed(0) : '—'}
              <span className="ml-0.5 text-xs font-normal text-gray-400">Mbps</span>
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {taluk.totalSamples > 0 ? `${taluk.totalSamples} tests` : 'No data yet'}
            </p>
          </a>
        ))}
      </div>

      <a href="/kerala" className="inline-block text-sm font-medium text-cf-orange hover:underline">
        ← All Kerala districts
      </a>
    </div>
  );
}
