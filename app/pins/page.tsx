import { isConfigured } from '@/lib/supabase';
import { listRenders } from '@/lib/renders';
import { listPinTemplates, listPins } from '@/lib/pins/data';
import { listFonts } from '@/lib/pins/fonts';
import { PinExport } from './PinExport';
import { anthropicModels, DEFAULT_ATLAS_MODEL, type CopyModel } from '@/lib/copy/generate';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { PinStudio } from './PinStudio';

export const dynamic = 'force-dynamic';

export default async function PinsPage() {
  if (!isConfigured) return <SetupNotice />;

  const [renders, templates, pins, fonts] = await Promise.all([
    listRenders(200),
    listPinTemplates(),
    listPins(),
    listFonts(),
  ]);

  const finished = renders.filter((r) => r.status === 'done' && r.url);

  // Atlas writes the copy by default; Claude joins the list when a key is set, because the
  // starred headlines were collected from Claude's output and feed back as style examples.
  const copyModels: CopyModel[] = process.env.ATLAS_CLOUD_API_KEY
    ? [
        { id: DEFAULT_ATLAS_MODEL, label: 'DeepSeek V4.1 Flash — fast, reliable JSON', provider: 'atlas' },
        { id: 'zai-org/glm-5.3-flash', label: 'GLM 5.3 Flash', provider: 'atlas' },
        { id: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', provider: 'atlas' },
        ...anthropicModels(),
      ]
    : anthropicModels();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-5 py-6">
      <div>
        <h1 className="text-base font-semibold">Pins</h1>
        <p className="text-xs leading-relaxed text-zinc-500">
          Built from your finished renders. Drawn in the browser, so it costs nothing and
          redraws as you type.
        </p>
      </div>

      {finished.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
          No finished renders yet. Run a batch on the Renders screen and they will appear here.
        </p>
      ) : (
        <PinStudio renders={finished} templates={templates} copyModels={copyModels} fonts={fonts} />
      )}

      {pins.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Saved pins <span className="font-normal text-zinc-500">{pins.length}</span>
            </h2>
            <PinExport pins={pins} />
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {pins.map((pin) => (
              <a
                key={pin.id}
                href={pin.url ?? '#'}
                download
                className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 transition hover:border-zinc-600"
              >
                <div className="relative aspect-[2/3] bg-zinc-950">
                  {pin.url ? (
                    /* Signed, expiring URLs — next/image would cache them past their lifetime. */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pin.url}
                      alt={pin.title ?? pin.design_title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <p className="truncate px-2 py-1.5 text-[11px] text-zinc-400">
                  {pin.title || pin.headline || pin.design_title}
                </p>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
