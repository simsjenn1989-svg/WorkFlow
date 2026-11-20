import { NextResponse } from 'next/server';
import { loadSource } from '@/lib/video/source';
import { prepareFrame, type FrameMode } from '@/lib/video/frame';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODES: FrameMode[] = ['crop', 'pad', 'original'];

/**
 * The exact frame that would be sent, as a JPEG.
 *
 * Served rather than described because framing is the whole decision here and it costs
 * nothing to look at. Generating a clip costs real money; finding out afterwards that the
 * crop took the model's head off is the expensive way to learn it.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const renderId = params.get('renderId');
  if (!renderId) return NextResponse.json({ error: 'No render given.' }, { status: 400 });

  const mode = (params.get('mode') ?? 'crop') as FrameMode;
  if (!MODES.includes(mode)) {
    return NextResponse.json({ error: 'Unknown framing.' }, { status: 400 });
  }

  const number = (name: string, fallback: number) => {
    const raw = Number(params.get(name));
    return Number.isFinite(raw) ? raw : fallback;
  };

  try {
    const source = await loadSource(renderId);
    const frame = await prepareFrame(source.image, {
      mode,
      focus: source.focus,
      offsetX: Math.max(-1, Math.min(1, number('offsetX', 0))),
      offsetY: Math.max(-1, Math.min(1, number('offsetY', 0))),
      // Preview size: large enough to judge, small enough to redraw as a slider moves.
      height: Math.max(240, Math.min(1920, number('height', 720))),
    });

    return new NextResponse(new Uint8Array(frame.jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Frame-Kept': frame.kept.toFixed(3),
        'X-Frame-Size': `${frame.width}x${frame.height}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
