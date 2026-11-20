/**
 * Atlas Cloud client.
 *
 * Verified against the live API rather than written from documentation:
 *   POST /api/v1/model/generateImage      -> { data: { id, status } }
 *   GET  /api/v1/model/prediction/{id}    -> { data: { status, outputs[], error } }
 *   statuses: created | processing | completed | failed
 *
 * Models are read from Atlas's public catalogue, and each model publishes an OpenAPI
 * schema describing its own inputs. The picker is therefore built from live data — no
 * hardcoded model list to go stale as Atlas adds models.
 */

const API = 'https://api.atlascloud.ai';

export type AtlasModel = {
  model: string;
  displayName: string;
  type: string;
  profile: string;
  categories: string[];
  tags: string[];
  schema: string;
  /** Listed base price in USD. Higher quality tiers cost more than this. */
  basePriceUsd: number;
  /**
   * What that price buys.
   *
   * 'call' means one image or one video; 'second' means one second of video. Measured across
   * the live catalogue: 32 of the 139 image-to-video models price per second and the other
   * 107 price per video, so treating them all the same would under-quote a ten-second clip
   * by an order of magnitude.
   */
  priceUnit: 'call' | 'second';
};

export type AtlasField = {
  name: string;
  type: string;
  description: string;
  default: unknown;
  enum?: string[];
};

export type PredictionStatus = 'created' | 'processing' | 'completed' | 'failed';

export type Prediction = {
  id: string;
  status: PredictionStatus;
  outputs: string[];
  error: string;
  /**
   * What Atlas actually charged, in dollars, as a string.
   *
   * Only present once the work is done, and worth far more than the estimate made before it
   * started. Measured on a real generation: two 2160x3840 images at quality `high` from
   * gpt-image-2.6-flare were quoted at $0.014 from the listed base price and charged
   * **$0.16168** — eleven times more. Size and quality tier multiply the base price by a
   * factor nothing in the catalogue publishes, so the only honest number is this one.
   */
  price?: string;
  /** "charged" once the money has actually been taken. */
  charge_status?: string;
};

/** What Atlas charged for a finished prediction, in cents, or null if it has not said. */
export function chargedCents(prediction: Prediction): number | null {
  const price = Number(prediction.price);
  if (!Number.isFinite(price) || price < 0) return null;
  // Rounded up: a sub-cent charge that rounds to zero would never move the monthly ceiling.
  return Math.ceil(price * 100);
}

function key(): string {
  const value = process.env.ATLAS_CLOUD_API_KEY;
  if (!value) throw new Error('ATLAS_CLOUD_API_KEY is not set.');
  return value;
}

export function isAtlasConfigured(): boolean {
  return Boolean(process.env.ATLAS_CLOUD_API_KEY);
}

async function atlas<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });

  const body = (await response.json().catch(() => null)) as
    | { code?: number; message?: string; data?: T }
    | null;

  if (!response.ok || !body) {
    throw new Error(`Atlas Cloud returned ${response.status}: ${body?.message ?? 'no response body'}`);
  }
  if (body.message) throw new Error(`Atlas Cloud: ${body.message}`);
  return body.data as T;
}

// ---------------------------------------------------------------- catalogue

type CatalogueEntry = {
  model: string;
  displayName: string;
  type: string;
  profile: string;
  categories?: string[];
  tags?: string[];
  schema?: string;
  price?: { actual?: { base_price?: string; unit?: string } };
};

let cache: { at: number; models: CatalogueEntry[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

/** The whole published catalogue, fetched once and reused. Public endpoint — no key needed. */
async function catalogue(): Promise<CatalogueEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;

  const response = await fetch(`${API}/api/v1/models`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Atlas Cloud catalogue returned ${response.status}`);
  const body = (await response.json()) as { data: CatalogueEntry[] };

  cache = { at: Date.now(), models: body.data ?? [] };
  return cache.models;
}

function toModel(entry: CatalogueEntry): AtlasModel {
  return {
    model: entry.model,
    displayName: entry.displayName,
    type: entry.type,
    profile: entry.profile,
    categories: entry.categories ?? [],
    tags: entry.tags ?? [],
    schema: entry.schema!,
    basePriceUsd: Number(entry.price?.actual?.base_price ?? 0),
    priceUnit: entry.price?.actual?.unit === 'second' ? 'second' : 'call',
  };
}

function byName(a: AtlasModel, b: AtlasModel): number {
  return a.displayName.localeCompare(b.displayName);
}

/** Every text-to-image model Atlas currently offers. */
export async function listImageModels(): Promise<AtlasModel[]> {
  return (await catalogue())
    .filter((m) => m.type === 'Image' && (m.categories ?? []).includes('TEXT-TO-IMAGE') && m.schema)
    .map(toModel)
    .sort(byName);
}

/**
 * The clip model to start from.
 *
 * Chosen by running nine models against the same frame and the same prompt and comparing the
 * printed graphic before and after — see docs/DEVELOPMENT.md. It held the print square and
 * sharp where the two LTX models rotated and blurred it, it kept hands out of the frame where
 * every Veo model invented a shirt-tugging gesture that crosses the graphic, and it gives 5
 * seconds against Veo's 4. It is also the cheapest of the nine at $0.009, which is 22 times
 * less than veo3.1 and was not the reason it won.
 *
 * Not a hardcoded list — just a starting point in a catalogue read live, and overridden by
 * picking anything else.
 */
export const DEFAULT_VIDEO_MODEL = 'bytedance/seedance-v1-pro-fast/image-to-video';

/**
 * Every image-to-video model, cheapest first, with the unpriced ones last.
 *
 * Cheapest first rather than alphabetical because this is the paid list and the price is the
 * thing being chosen between — measured at $0.009 to $0.134 a clip across 139 models.
 *
 * A handful publish no price at all. Sorting those to the front by their nominal zero would
 * put a model that cannot be quoted at the top of the list and make it the default, which is
 * exactly backwards for a screen whose job is to show the cost before anything runs.
 */
export async function listVideoModels(): Promise<AtlasModel[]> {
  return (await catalogue())
    .filter((m) => m.type === 'Video' && (m.categories ?? []).includes('IMAGE-TO-VIDEO') && m.schema)
    .map(toModel)
    .sort((a, b) => {
      const priced = Number(b.basePriceUsd > 0) - Number(a.basePriceUsd > 0);
      return priced || a.basePriceUsd - b.basePriceUsd || byName(a, b);
    });
}

export async function getModel(id: string): Promise<AtlasModel | null> {
  const entry = (await catalogue()).find((m) => m.model === id && m.schema);
  return entry ? toModel(entry) : null;
}

/**
 * The model's own input fields, from its published OpenAPI schema. `model` and `prompt` are
 * dropped: the app always supplies those.
 */
export async function getModelFields(model: AtlasModel): Promise<AtlasField[]> {
  return (await getModelInput(model)).fields;
}

/**
 * The model's inputs and which of them it insists on.
 *
 * `required` is worth having separately: measured across 40 of the image-to-video models,
 * 23 require a prompt and 17 do not. Leaving the motion prompt blank is fine on some and a
 * guaranteed rejection on the rest, and finding out from Atlas after the job is submitted is
 * the wrong moment.
 */
export async function getModelInput(
  model: AtlasModel,
): Promise<{ fields: AtlasField[]; required: string[] }> {
  const response = await fetch(model.schema, { cache: 'no-store' });
  if (!response.ok) return { fields: [], required: [] };

  const doc = (await response.json()) as {
    components?: {
      schemas?: {
        Input?: {
          required?: string[];
          properties?: Record<
            string,
            { type?: string; description?: string; default?: unknown; enum?: string[] }
          >;
        };
      };
    };
  };

  const input = doc.components?.schemas?.Input;
  const properties = input?.properties ?? {};

  return {
    required: input?.required ?? [],
    fields: Object.entries(properties)
      .filter(([name]) => name !== 'model' && name !== 'prompt')
      .map(([name, spec]) => ({
        name,
        type: spec.type ?? 'string',
        description: spec.description ?? '',
        default: spec.default,
        ...(spec.enum ? { enum: spec.enum } : {}),
      })),
  };
}

// ---------------------------------------------------------------- generation

export async function startGeneration(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
): Promise<Prediction> {
  return atlas<Prediction>('/api/v1/model/generateImage', {
    method: 'POST',
    body: JSON.stringify({ ...params, model, prompt }),
  });
}

/**
 * Start a video generation.
 *
 * A different endpoint from images — `/generateVideo`, per every image-to-video model's own
 * published schema — but the same prediction to poll afterwards.
 */
export async function startVideoGeneration(
  model: string,
  params: Record<string, unknown>,
): Promise<Prediction> {
  return atlas<Prediction>('/api/v1/model/generateVideo', {
    method: 'POST',
    body: JSON.stringify({ ...params, model }),
  });
}

export async function getPrediction(id: string): Promise<Prediction> {
  return atlas<Prediction>(`/api/v1/model/prediction/${encodeURIComponent(id)}`);
}

/**
 * Atlas serves finished images from its own media host. They are fetched once and copied
 * into Supabase storage, because these URLs are not guaranteed to live forever.
 */
export async function downloadOutput(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Downloading the generated image returned ${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'image/png',
  };
}

/** Listed base price × count, in cents. Quality tiers above the default cost more. */
export function estimateCents(model: AtlasModel, count: number): number {
  return Math.round(model.basePriceUsd * count * 100);
}

/**
 * What one clip costs, in cents.
 *
 * Respects the price unit: a per-second model multiplied by the clip length, a per-video
 * model charged once however long it runs. Still an estimate — a resolution above the
 * model's default costs more than the listed base price, which is why nothing here is
 * presented as a final figure.
 *
 * Rounds UP, which matters more than it looks. Three of the image-to-video models are priced
 * under a cent a clip ($0.002, $0.007 a second, $0.009), and `Math.round` turned those into
 * zero: the screen offered them as free, the ledger would have recorded nothing, and the
 * monthly ceiling would never move however many were made. Rounding up over-records by a
 * fraction of a cent, which is the safe direction for a spending limit. `priceUsd` is there
 * for showing the real figure.
 */
export function estimateVideoCents(model: AtlasModel, durationSeconds: number): number {
  return Math.ceil(priceUsd(model, durationSeconds) * 100);
}

/** The listed price for a clip of this length, in dollars, unrounded. */
export function priceUsd(model: AtlasModel, durationSeconds: number): number {
  const seconds = Math.max(1, Math.round(durationSeconds));
  return model.basePriceUsd * (model.priceUnit === 'second' ? seconds : 1);
}
