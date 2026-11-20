import { NextResponse } from 'next/server';
import { getModel, getModelInput } from '@/lib/atlas';

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
    const input = await getModelInput(model);
    return NextResponse.json({
      fields: input.fields,
      // Which inputs the model insists on, so a form can say so before anything is
      // submitted rather than relaying a rejection afterwards.
      required: input.required,
      basePriceUsd: model.basePriceUsd,
      priceUnit: model.priceUnit,
      profile: model.profile,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
