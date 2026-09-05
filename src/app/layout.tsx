import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';

// Per-request CSP nonces and private account state require dynamic rendering.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Sankalpa — Your personal practice', template: '%s | Sankalpa' },
  description:
    'A quiet space for your daily practice. Define a personal intention and follow your chosen routine.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
