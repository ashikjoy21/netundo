import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/site';

// The page itself is a client component, so its metadata lives in this layout.
export const metadata: Metadata = pageMetadata(
  '/charts',
  'Fastest Internet Providers in Kerala — Top Charts | netundo',
  'Kerala internet providers ranked by real speed tests: broadband and mobile, by district, for streaming, gaming, video calls and work.',
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
