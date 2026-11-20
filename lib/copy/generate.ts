import { SYSTEM_PROMPT } from './system-prompt';
import { BUDGET, callModel, CopyError } from './models';
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

export async function generateCopy(modelId: string, request: CopyRequest): Promise<CopyResult> {
  const user = buildCopyPrompt(request);
  const raw = await callModel(providerOf(modelId), modelId, {
    system: SYSTEM_PROMPT,
    user,
    budget: BUDGET,
  });

  const result = normaliseResult(parseReply(raw));
  if (!result) {
    throw new CopyError('That model did not return usable copy. Try another one.');
  }
  return result;
}

// Re-exported so existing imports of CopyError from this module keep working; the class
// itself now lives next to the calls that throw it.
export { CopyError };
