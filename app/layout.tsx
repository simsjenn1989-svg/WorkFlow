import type { Metadata } from 'next';
import Link from 'next/link';
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
          <nav className="flex items-center gap-4 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-100">
              Board
            </Link>
            <Link href="/collections" className="hover:text-zinc-100">
              Collections
            </Link>
          </nav>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
