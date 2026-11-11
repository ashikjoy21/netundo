import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/site';

// The page itself is a client component, so its metadata lives in this layout.
export const metadata: Metadata = pageMetadata(
  '/kerala',
  'Internet Speed & Broadband Providers in Kerala by District | netundo',
  'Compare broadband and mobile internet speeds across all 14 Kerala districts. Pick your district to see local providers and speeds by area.',
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
