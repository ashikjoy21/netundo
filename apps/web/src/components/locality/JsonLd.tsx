import type { FaqItem } from '@/lib/localityData';
import type { Crumb } from './Breadcrumbs';
import { absoluteUrl } from '@/lib/site';

/** Emits FAQPage + BreadcrumbList structured data so Google can render rich
 *  results and understand the page hierarchy. */
export function LocalityJsonLd({ faqs, crumbs }: { faqs: FaqItem[]; crumbs: Crumb[] }) {
  const graph: unknown[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.label,
        ...(crumb.href ? { item: absoluteUrl(crumb.href) } : {}),
      })),
    },
  ];

  if (faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    });
  }

  const data = { '@context': 'https://schema.org', '@graph': graph };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
