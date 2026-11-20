/**
 * What to do with a caught error when the work behind it has already been paid for.
 *
 * This is a policy, not a pipeline. Collecting a finished generation, downloading a clip and
 * creating a Printify product share almost no code — but they share the decision that got
 * made wrongly twice: a thrown fetch was treated as the work having failed, so a job that
 * Atlas had completed and charged for was marked dead and its output discarded. Polling once
 * more would have collected it.
 *
 * Both times the fix was the same three lines, which is the argument for them living here
 * rather than being rediscovered by whatever polls something next.
 *
 * Deliberately NOT a shared collector. The two pollers download and store different things in
 * different tables, and forcing them through one function would produce an abstraction that
 * fits neither. Only the judgement is shared.
 */

/** Atlas quotes seconds for images and up to three minutes for video. */
export const GIVE_UP_MS = 15 * 60 * 1000;

/**
 * True when the error is an answer rather than a blip.
 *
 * A 4xx is the service saying no: retrying returns the same thing and only delays the news.
 * A dropped connection, a reset, a gateway hiccup — those are worth trying again, and were
 * the actual cause both times this went wrong (a 520 from a CDN while downloading a finished
 * image, and a `ClosedEndpoint` from Atlas on a model taken out of service mid-job).
 *
 * `ClosedEndpoint` is listed by name because it arrives as a 400 inside a message rather than
 * as a status code on the response.
 */
export function isPermanentFailure(message: string): boolean {
  return (
    /\b4\d\d\b/.test(message) ||
    /ClosedEndpoint|InvalidEndpoint|Unauthorized|Forbidden|not found|invalid/i.test(message)
  );
}

export type FailureVerdict = {
  /** Give up and mark it failed. */
  permanent: boolean;
  /** The message to store either way. */
  message: string;
};

/**
 * Decide whether a thrown collection ends the work or just this attempt.
 *
 * `startedAt` is when the work began, not when this attempt did: a service that keeps
 * dropping the connection should eventually be called a failure rather than retried forever.
 */
export function judgeFailure(error: unknown, startedAt: string | Date): FailureVerdict {
  const message = error instanceof Error ? error.message : String(error);
  const age = Date.now() - new Date(startedAt).getTime();
  return {
    permanent: isPermanentFailure(message) || age >= GIVE_UP_MS,
    message,
  };
}

/**
 * Run a step and say which one failed.
 *
 * Node's fetch throws a bare `TypeError: fetch failed` with the real reason tucked into
 * `cause`, so an unlabelled failure among several fetches is indistinguishable between them.
 */
export async function step<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const cause = (error as { cause?: { message?: string; code?: string } }).cause;
    const detail = [cause?.code, cause?.message].filter(Boolean).join(' ');
    throw new Error(`Failed ${what}: ${(error as Error).message}${detail ? ` (${detail})` : ''}`);
  }
}
