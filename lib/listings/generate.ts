import { callModel, CopyError } from '@/lib/copy/models';
import { providerOf } from '@/lib/copy/generate';
import { parseReply } from '@/lib/copy/salvage';
import { buildListingPrompt, LISTING_SYSTEM_PROMPT, normaliseParts, type ListingParts, type ListingRequest } from './prompt';

/**
 * Ask a model for the written parts of a listing.
 *
 * Shares the provider plumbing with the pin copy — same budget, same salvage for a reply
 * that got cut off mid-object, same reason for not sending `temperature` to Claude.
 */
export async function generateListing(
  modelId: string,
  request: ListingRequest,
): Promise<ListingParts> {
  const raw = await callModel(providerOf(modelId), modelId, {
    system: LISTING_SYSTEM_PROMPT,
    user: buildListingPrompt(request),
  });

  const parts = normaliseParts(parseReply(raw));
  if (!parts) {
    throw new CopyError('That model did not return usable listing copy. Try another one.');
  }
  return parts;
}
