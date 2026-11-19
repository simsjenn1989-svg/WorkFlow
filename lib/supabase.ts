import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const BUCKET = 'workflow';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** False until both Supabase variables are set, so pages can show setup help instead of crashing. */
export const isConfigured = Boolean(url && serviceKey);

let cached: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service role key.
 *
 * The service role bypasses RLS, which is exactly what a single-operator app wants — but it
 * means this must never be imported into a client component. Every table has RLS enabled
 * with no anon policies, so the browser could not read them even if a key leaked.
 */
export function db(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  cached ??= createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** A short-lived signed URL for a private object, or null if there is no path. */
export async function signedUrl(path: string | null, expiresIn = 3600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}
