/**
 * Single shared password, signed-cookie session.
 *
 * Written against Web Crypto only, because middleware runs on the Edge runtime where
 * node:crypto is not available. The same helpers are therefore usable from middleware,
 * server components and server actions alike.
 *
 * The HMAC key is derived from APP_PASSWORD rather than being a second secret. That keeps
 * deployment to one variable, and has a useful side effect: changing the password
 * invalidates every existing session.
 */

export const SESSION_COOKIE = 'workflow_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function password(): string {
  const value = process.env.APP_PASSWORD;
  if (!value) throw new Error('APP_PASSWORD is not set.');
  return value;
}

async function signingKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password()));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A token of the form `<expiry seconds>.<hmac>`. */
export async function createSessionToken(): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(),
    encoder.encode(String(expires)),
  );
  return `${expires}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token || !isAuthConfigured()) return false;

  const separator = token.indexOf('.');
  if (separator < 1) return false;

  const expiresPart = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);

  const expires = Number(expiresPart);
  if (!Number.isSafeInteger(expires) || expires * 1000 <= Date.now()) return false;

  const signature = fromBase64Url(signaturePart);
  if (!signature) return false;

  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify(
    'HMAC',
    await signingKey(),
    signature as unknown as ArrayBuffer,
    encoder.encode(expiresPart),
  );
}

/**
 * Constant-time password comparison. Lengths are compared through the loop rather than
 * returning early, so a wrong guess costs the same time whatever its length.
 */
export function passwordMatches(candidate: string): boolean {
  const expected = encoder.encode(password());
  const given = encoder.encode(candidate);
  let diff = expected.length ^ given.length;
  for (let i = 0; i < Math.max(expected.length, given.length); i++) {
    diff |= (expected[i % expected.length] ?? 0) ^ (given[i % (given.length || 1)] ?? 0);
  }
  return diff === 0;
}
