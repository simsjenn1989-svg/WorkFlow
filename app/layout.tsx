import type { Metadata } from 'next';
import Link from 'next/link';
import { HeaderNav } from '@/components/HeaderNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'WorkFlow',
  description: 'Design to published listing, in one pipeline.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-full flex-col">
        <header className="flex items-center gap-6 border-b border-zinc-900 px-5 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            WorkFlow
          </Link>
          <HeaderNav />
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
