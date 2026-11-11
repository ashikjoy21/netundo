/** Canonical site origin used for absolute URLs (canonical tags, sitemap, JSON-LD). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://netundo.com').replace(/\/$/, '');

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Per-page metadata with a self-referencing canonical (static pages had none, so
 *  Google saw several URLs sharing one title and no canonical). */
export function pageMetadata(path: string, title: string, description: string) {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: 'website' as const, url },
  };
}
