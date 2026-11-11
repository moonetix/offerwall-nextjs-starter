import type { Metadata } from 'next';
import Link from 'next/link';
import { MoonetixEmbed } from '@/components/moonetix-embed';
import './globals.css';

export const metadata: Metadata = {
  title: 'Offerwall starter',
  description: 'Next.js starter with the Moonetix offerwall and a verified postback route.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Your app</Link>
          <nav>
            <Link href="/earn">Earn</Link>
          </nav>
        </header>
        {children}
        <MoonetixEmbed />
      </body>
    </html>
  );
}
