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
  /** Listed base price per image in USD. Higher quality tiers cost more than this. */
  basePriceUsd: number;
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
};

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
  price?: { actual?: { base_price?: string } };
};

let cache: { at: number; models: AtlasModel[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

/** Every text-to-image model Atlas currently offers. Public endpoint — no key needed. */
export async function listImageModels(): Promise<AtlasModel[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;

  const response = await fetch(`${API}/api/v1/models`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Atlas Cloud catalogue returned ${response.status}`);
  const body = (await response.json()) as { data: CatalogueEntry[] };

  const models = body.data
    .filter((m) => m.type === 'Image' && (m.categories ?? []).includes('TEXT-TO-IMAGE') && m.schema)
    .map<AtlasModel>((m) => ({
      model: m.model,
      displayName: m.displayName,
      type: m.type,
      profile: m.profile,
      categories: m.categories ?? [],
      tags: m.tags ?? [],
      schema: m.schema!,
      basePriceUsd: Number(m.price?.actual?.base_price ?? 0),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  cache = { at: Date.now(), models };
  return models;
}

export async function getModel(id: string): Promise<AtlasModel | null> {
  return (await listImageModels()).find((m) => m.model === id) ?? null;
}

/**
 * The model's own input fields, from its published OpenAPI schema. `model` and `prompt` are
 * dropped: the app always supplies those.
 */
export async function getModelFields(model: AtlasModel): Promise<AtlasField[]> {
  const response = await fetch(model.schema, { cache: 'no-store' });
  if (!response.ok) return [];

  const doc = (await response.json()) as {
    components?: {
      schemas?: {
        Input?: {
          properties?: Record<
            string,
            { type?: string; description?: string; default?: unknown; enum?: string[] }
          >;
        };
      };
    };
  };

  const properties = doc.components?.schemas?.Input?.properties ?? {};
  return Object.entries(properties)
    .filter(([name]) => name !== 'model' && name !== 'prompt')
    .map(([name, spec]) => ({
      name,
      type: spec.type ?? 'string',
      description: spec.description ?? '',
      default: spec.default,
      ...(spec.enum ? { enum: spec.enum } : {}),
    }));
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
