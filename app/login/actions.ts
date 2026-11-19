'use server';

import type { Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  isAuthConfigured,
  passwordMatches,
} from '@/lib/auth';

export type LoginResult = { error: string };

export async function logIn(_prev: LoginResult, form: FormData): Promise<LoginResult> {
  if (!isAuthConfigured()) {
    return { error: 'APP_PASSWORD is not set on the server.' };
  }

  const candidate = String(form.get('password') ?? '');
  if (!candidate) return { error: 'Enter the password.' };

  if (!passwordMatches(candidate)) {
    // A small delay blunts rapid guessing without needing shared state across instances.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { error: 'That password is not right.' };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  const next = String(form.get('next') ?? '');
  // Only same-site paths, so a crafted ?next= cannot bounce you off to another host.
  // typedRoutes cannot know a runtime path, and the guard above has already restricted it
  // to a same-site absolute path.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  redirect(target as Route);
}

export async function logOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login' as Route);
}
