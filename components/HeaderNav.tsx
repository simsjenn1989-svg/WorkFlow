'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logOut } from '@/app/login/actions';

/**
 * Hidden on the login page — offering "Board" and "Sign out" to someone who is not signed in
 * is just noise.
 */
export function HeaderNav() {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  return (
    <>
      <nav className="flex items-center gap-4 text-sm text-zinc-400">
        <Link href="/" className="hover:text-zinc-100">
          Board
        </Link>
        <Link href="/generate" className="hover:text-zinc-100">
          Generate
        </Link>
        <Link href="/prompts" className="hover:text-zinc-100">
          Prompts
        </Link>
        <Link href="/collections" className="hover:text-zinc-100">
          Collections
        </Link>
      </nav>
      <form action={logOut} className="ml-auto">
        <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-300">
          Sign out
        </button>
      </form>
    </>
  );
}
