import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Ituti AI Assurance', template: '%s · Ituti AI Assurance' },
  icons: { icon: '/ituti-icon.svg' },
  description: 'Classify AI systems under the EU AI Act and UK rules, assess controls mapped to ISO/IEC 42001 and NIST AI RMF, and keep reports, model cards and monitoring for every client.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
