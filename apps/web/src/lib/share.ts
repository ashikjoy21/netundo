import { absoluteUrl } from './site';

/** WhatsApp share link; works on phones (app) and desktop (web). */
export function whatsappShareUrl(text: string, path: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${absoluteUrl(path)}`)}`;
}

/** Use the native share sheet where available, else open WhatsApp. */
export async function shareOrWhatsapp(text: string, path: string): Promise<void> {
  const url = absoluteUrl(path);
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ text, url });
      return;
    } catch {
      // Cancelled or unsupported — fall through to WhatsApp.
    }
  }
  window.open(whatsappShareUrl(text, path), '_blank', 'noopener');
}
