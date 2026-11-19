import { NextResponse } from 'next/server';
import { getModel, getModelFields } from '@/lib/atlas';

export const runtime = 'nodejs';

/**
 * The chosen model's own input fields, so the form can offer exactly what that model
 * accepts. Fetched on demand rather than up front: the catalogue runs to hundreds of
 * models and each publishes its own schema.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('model');
  if (!id) return NextResponse.json({ error: 'No model given.' }, { status: 400 });

  const model = await getModel(id);
  if (!model) return NextResponse.json({ error: `Unknown model "${id}".` }, { status: 404 });

  try {
    return NextResponse.json({
      fields: await getModelFields(model),
      basePriceUsd: model.basePriceUsd,
      profile: model.profile,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
