/**
 * One HTTP call to whichever model wrote the copy.
 *
 * Pulled out of `generate.ts` when listing copy became a second caller. The provider
 * differences below are small but each one cost a real bug, so they live in exactly one
 * place rather than being re-derived per feature.
 */

export type Provider = 'atlas' | 'anthropic';

export class CopyError extends Error {}

/**
 * Token budget per reply.
 *
 * Several of these models think before answering, and the thinking comes out of the same
 * budget. Measured on the real prompt, DeepSeek spent between 579 and 1373 tokens reasoning
 * for a 750-character answer — so a budget of 1400 truncated it to nothing some of the time
 * and worked other times, which is the worst kind of bug. The budget is set well clear of
 * that, and a truncated reply is retried once with more.
 */
export const BUDGET = 3000;
export const RETRY_BUDGET = 6000;

export type CallOptions = {
  system: string;
  user: string;
  budget?: number;
};

export async function callModel(
  provider: Provider,
  model: string,
  options: CallOptions,
): Promise<string> {
  return provider === 'anthropic' ? callAnthropic(model, options) : callAtlas(model, options);
}

export async function callAtlas(model: string, options: CallOptions): Promise<string> {
  const key = process.env.ATLAS_CLOUD_API_KEY;
  if (!key) throw new CopyError('ATLAS_CLOUD_API_KEY is not set.');

  const budget = options.budget ?? BUDGET;

  const response = await fetch('https://api.atlascloud.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      max_tokens: budget,
      temperature: 0.7,
    }),
  });

  if (response.status === 429) {
    throw new CopyError('That model is busy right now. Try again, or pick another one.');
  }
  if (!response.ok) {
    throw new CopyError(`Atlas Cloud returned ${response.status}.`);
  }

  const body = (await response.json()) as {
    choices?: {
      finish_reason?: string;
      message?: { content?: string; reasoning_content?: string };
    }[];
  };
  const choice = body.choices?.[0];
  const content = (choice?.message?.content ?? '').trim();

  // Ran out of budget mid-answer: give it more room once rather than blaming the model.
  if (choice?.finish_reason === 'length' && content.length < 200 && budget < RETRY_BUDGET) {
    return callAtlas(model, { ...options, budget: RETRY_BUDGET });
  }

  if (!content) {
    throw new CopyError(
      choice?.message?.reasoning_content
        ? 'That model spent its whole budget thinking and replied with nothing. Try another one.'
        : 'That model replied with nothing. Try another one.',
    );
  }
  return content;
}

/**
 * Note the absence of `temperature`.
 *
 * Claude 5.5 models reject a non-default `temperature` with a 400, and from API version
 * 2026-10-21 every model does. Variety comes from asking for different angles in the prompt,
 * which is a better way to get it than a sampling knob.
 */
export async function callAnthropic(model: string, options: CallOptions): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new CopyError('ANTHROPIC_API_KEY is not set.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      model,
      max_tokens: options.budget ?? BUDGET,
      system: options.system,
      messages: [{ role: 'user', content: options.user }],
      // Thinking is on by default on these models and comes out of max_tokens, so a short
      // copywriting task at the default effort would spend most of the budget reasoning.
      // Low effort is the right setting for work this small.
      output_config: { effort: 'low' },
    }),
  });

  if (response.status === 429) {
    throw new CopyError('Anthropic is rate limiting right now. Try again shortly.');
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new CopyError(detail?.error?.message ?? `Anthropic returned ${response.status}.`);
  }

  const body = (await response.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}
