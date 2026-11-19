import { SYSTEM_PROMPT } from './system-prompt';
import { parseReply } from './salvage';
import { buildCopyPrompt, normaliseResult, type CopyRequest, type CopyResult } from './prompt';

/**
 * Copy generation, over whichever provider is configured.
 *
 * Atlas needs no extra setup — the key is already there for designs. Claude appears as well
 * when ANTHROPIC_API_KEY is set, because the starred headlines were collected from Claude's
 * output and are fed back as style examples, so matching that voice is a reasonable thing
 * to want. Both are one HTTP call returning JSON, so neither is more work to keep.
 */

export type CopyModel = { id: string; label: string; provider: 'atlas' | 'anthropic' };

/** Default: fast, cheap, and it writes to the brief. */
export const DEFAULT_ATLAS_MODEL = 'deepseek-ai/deepseek-v4.1-flash';

/**
 * Token budget per reply.
 *
 * Several of these models think before answering, and the thinking comes out of the same
 * budget. Measured on the real prompt, DeepSeek spent between 579 and 1373 tokens reasoning
 * for a 750-character answer — so a budget of 1400 truncated it to nothing some of the time
 * and worked other times, which is the worst kind of bug. The budget is set well clear of
 * that, and a truncated reply is retried once with more.
 */
const BUDGET = 3000;
const RETRY_BUDGET = 6000;

/** Claude models offered when a key is present. Ordered cheapest-first. */
const CLAUDE_MODELS: CopyModel[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic' },
];

export function hasAnthropic(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function anthropicModels(): CopyModel[] {
  return hasAnthropic() ? CLAUDE_MODELS : [];
}

export function providerOf(modelId: string): 'atlas' | 'anthropic' {
  return CLAUDE_MODELS.some((m) => m.id === modelId) ? 'anthropic' : 'atlas';
}

export class CopyError extends Error {}

export async function generateCopy(modelId: string, request: CopyRequest): Promise<CopyResult> {
  const user = buildCopyPrompt(request);
  const raw =
    providerOf(modelId) === 'anthropic'
      ? await callAnthropic(modelId, user)
      : await callAtlas(modelId, user);

  const result = normaliseResult(parseReply(raw));
  if (!result) {
    throw new CopyError('That model did not return usable copy. Try another one.');
  }
  return result;
}

async function callAtlas(model: string, user: string, budget = BUDGET): Promise<string> {
  const key = process.env.ATLAS_CLOUD_API_KEY;
  if (!key) throw new CopyError('ATLAS_CLOUD_API_KEY is not set.');

  const response = await fetch('https://api.atlascloud.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
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
    return callAtlas(model, user, RETRY_BUDGET);
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

async function callAnthropic(model: string, user: string): Promise<string> {
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
      max_tokens: BUDGET,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (response.status === 429) {
    throw new CopyError('Anthropic is rate limiting right now. Try again shortly.');
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new CopyError(detail?.error?.message ?? `Anthropic returned ${response.status}.`);
  }

  const body = (await response.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}
