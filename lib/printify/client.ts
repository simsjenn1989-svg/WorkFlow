/**
 * Printify REST client.
 *
 * Written against the live API, not documentation. Every shape below was observed from the
 * real account before it was typed — see docs/DECISIONS.md for the transcript of probes:
 *
 *   GET  /v1/shops.json
 *     -> [{ id: 29804351, title: "The Unfiltered Club", sales_channel: "tiktok" }, ...]
 *   GET  /v1/catalog/blueprints/{bp}/print_providers/{pp}/variants.json
 *     -> { variants: [{ id, title, options: { color, size }, placeholders: [...] }] }
 *   POST /v1/uploads/images.json
 *     -> { id, file_name, width, height, size, mime_type, preview_url, upload_time }
 *   POST /v1/shops/{shop}/products.json
 *     -> the created product
 *
 * The one thing deliberately absent is POST /v1/shops/{shop}/products/{id}/publish.json. A
 * product created through this API is a draft until that call is made, and this app never
 * makes it: the user publishes by hand after reviewing. There is no code path to publishing,
 * which is stronger than a flag that could be flipped by mistake.
 */

const API = 'https://api.printify.com/v1';

export type PrintifyShop = {
  id: number;
  title: string;
  sales_channel: string;
};

/** One print position on a garment: Printify names these exactly 'front', 'back', ... */
export type Placeholder = {
  position: string;
  width: number;
  height: number;
};

export type CatalogVariant = {
  id: number;
  title: string;
  options: { color?: string; size?: string };
  placeholders: Placeholder[];
};

export type UploadedImage = {
  id: string;
  file_name: string;
  width: number;
  height: number;
  size: number;
  mime_type: string;
  preview_url: string;
};

/** Where one image sits in one print area, in Printify's normalised units. */
export type ImagePlacement = {
  id: string;
  /** Centre of the image across the print area, 0..1. */
  x: number;
  y: number;
  /** 1 fills the print area's width. */
  scale: number;
  angle: number;
};

export type CreateProductInput = {
  title: string;
  description: string;
  tags: string[];
  blueprint_id: number;
  print_provider_id: number;
  variants: { id: number; price: number; is_enabled: boolean }[];
  print_areas: {
    variant_ids: number[];
    placeholders: { position: string; images: ImagePlacement[] }[];
  }[];
  /**
   * Kept out of the shop's active product list.
   *
   * Not calling the publish endpoint is already enough to keep a product off Etsy and TikTok,
   * but `visible: false` is the stronger statement: the product does not even show as active
   * in Printify. Measured — a PUT with visible false comes back with visible false, so the
   * field is honoured rather than ignored.
   */
  visible?: boolean;
};

export type CreatedProduct = {
  id: string;
  title: string;
  visible: boolean;
};

function token(): string {
  const value = process.env.PRINTIFY_API_TOKEN;
  if (!value) throw new Error('PRINTIFY_API_TOKEN is not set.');
  return value;
}

export function isPrintifyConfigured(): boolean {
  return Boolean(process.env.PRINTIFY_API_TOKEN);
}

async function printify<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      // Printify asks API clients to identify themselves. Deliberately generic: this is an
      // outbound request to a third party and carries nothing about who is running the app.
      'User-Agent': 'workflow-app',
      ...init?.headers,
    },
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) {
    // Printify reports validation problems as { errors: { reason: "..." } } alongside a
    // message. The reason is the useful half, so both are surfaced.
    let detail = text.slice(0, 400);
    try {
      const body = JSON.parse(text) as { message?: string; errors?: { reason?: string } };
      detail = [body.message, body.errors?.reason].filter(Boolean).join(' — ') || detail;
    } catch {
      // Not JSON: an HTML error page or a proxy message. The raw text is the best clue.
    }
    throw new Error(`Printify ${response.status}: ${detail}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

export async function listShops(): Promise<PrintifyShop[]> {
  return printify<PrintifyShop[]>('/shops.json');
}

/**
 * Every variant a blueprint/provider pair offers, with its print areas.
 *
 * Worth knowing: the placeholder size is *per variant*, not per blueprint. For Comfort Colors
 * 1717 via Printify Choice, S is 3703 x 4200 while L and up are 4494 x 5097. Print art has to
 * be prepared for the largest, or the biggest sizes print a scaled-up file.
 */
export async function listCatalogVariants(
  blueprintId: number,
  printProviderId: number,
): Promise<CatalogVariant[]> {
  const body = await printify<{ variants: CatalogVariant[] }>(
    `/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`,
  );
  return body.variants ?? [];
}

/** The largest print area across a set of variants, which is what art should be sized for. */
export function largestPlaceholder(
  variants: CatalogVariant[],
  position: string,
): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null;
  for (const variant of variants) {
    for (const placeholder of variant.placeholders) {
      if (placeholder.position !== position) continue;
      const area = placeholder.width * placeholder.height;
      if (!best || area > best.width * best.height) {
        best = { width: placeholder.width, height: placeholder.height };
      }
    }
  }
  return best;
}

/**
 * Send an image to Printify's library by URL.
 *
 * By URL rather than by base64 on purpose: print art is a 4000px PNG, several megabytes, and
 * base64 adds a third again. Posting that through a serverless function means holding the
 * whole file in memory and pushing it twice over the wire. A signed Supabase URL lets
 * Printify fetch it directly, so the function only passes along a string.
 *
 * The returned id is permanent and reusable — a second product can reference the same image
 * without uploading it again, which is why printify_uploads exists.
 */
export async function uploadImageByUrl(fileName: string, url: string): Promise<UploadedImage> {
  return printify<UploadedImage>('/uploads/images.json', {
    method: 'POST',
    body: JSON.stringify({ file_name: fileName, url }),
  });
}

/** Send an image as base64. Only for cases where no URL can be handed out. */
export async function uploadImageByContents(
  fileName: string,
  bytes: Buffer,
): Promise<UploadedImage> {
  return printify<UploadedImage>('/uploads/images.json', {
    method: 'POST',
    body: JSON.stringify({ file_name: fileName, contents: bytes.toString('base64') }),
  });
}

/**
 * Create an unpublished product. It appears in Printify as a draft, ready for review.
 *
 * `visible` defaults to false here rather than at the call site, so there is no way to create
 * a product through this app that lands in the shop as active.
 */
export async function createProduct(
  shopId: string,
  input: CreateProductInput,
): Promise<CreatedProduct> {
  return printify<CreatedProduct>(`/shops/${shopId}/products.json`, {
    method: 'POST',
    body: JSON.stringify({ visible: false, ...input }),
  });
}

export async function updateProduct(
  shopId: string,
  productId: string,
  input: Partial<CreateProductInput>,
): Promise<CreatedProduct> {
  return printify<CreatedProduct>(`/shops/${shopId}/products/${productId}.json`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteProduct(shopId: string, productId: string): Promise<void> {
  await printify<null>(`/shops/${shopId}/products/${productId}.json`, { method: 'DELETE' });
}

/** The product's page in Printify, for a link straight to the draft. */
export function productUrl(shopId: string, productId: string): string {
  return `https://printify.com/app/store/${shopId}/products/${productId}/edit`;
}
