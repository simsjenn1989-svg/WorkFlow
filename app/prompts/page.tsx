import { isConfigured } from '@/lib/supabase';
import { listPrompts, slotsIn } from '@/lib/queries';
import { createPrompt, deletePrompt, updatePrompt } from '@/app/generate/actions';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { ActionForm } from '@/components/ActionForm';
import { SubmitButton } from '@/components/SubmitButton';
import { DangerButton } from '@/components/DangerButton';

export const dynamic = 'force-dynamic';

export default async function PromptsPage() {
  if (!isConfigured) return <SetupNotice />;
  const prompts = await listPrompts();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-5 py-6">
      <section className="space-y-3">
        <div>
          <h1 className="text-base font-semibold">Prompts</h1>
          <p className="text-xs leading-relaxed text-zinc-500">
            The prompts that actually work are the asset here, so they are kept rather than
            retyped. Write <code className="text-zinc-400">{'{{slots}}'}</code> for the parts you
            swap each time — they become fields on the generate screen.
          </p>
        </div>

        <ActionForm
          action={createPrompt}
          className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-zinc-400">
              Name
              <input name="name" required maxLength={120} className="field" placeholder="Retro tee lettering" />
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              Model it is tuned for
              <input
                name="targetModel"
                maxLength={200}
                className="field"
                placeholder="openai/gpt-image-2.6-flare/text-to-image"
              />
            </label>
          </div>
          <label className="block space-y-1 text-xs text-zinc-400">
            Prompt
            <textarea
              name="body"
              required
              rows={4}
              maxLength={32000}
              className="field"
              placeholder="Light cream retro lettering reading {{phrase}}, {{style}} style, flat vector, transparent background, no mockup"
            />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Notes
            <input name="notes" maxLength={2000} className="field" placeholder="optional" />
          </label>
          <SubmitButton pendingLabel="Saving…">Save prompt</SubmitButton>
        </ActionForm>
      </section>

      <section className="space-y-3">
        {prompts.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No prompts saved yet. You can also generate without one.
          </p>
        ) : (
          prompts.map((prompt) => (
            <details key={prompt.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40">
              <summary className="cursor-pointer px-4 py-3">
                <span className="text-sm font-medium text-zinc-100">{prompt.name}</span>
                {slotsIn(prompt.body).length > 0 ? (
                  <span className="ml-2 text-[11px] text-zinc-500">
                    {slotsIn(prompt.body).join(', ')}
                  </span>
                ) : null}
                <span className="mt-1 block truncate text-xs text-zinc-500">{prompt.body}</span>
              </summary>

              <div className="border-t border-zinc-800 p-4">
                <ActionForm action={updatePrompt.bind(null, prompt.id)} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs text-zinc-400">
                      Name
                      <input name="name" defaultValue={prompt.name} required maxLength={120} className="field" />
                    </label>
                    <label className="space-y-1 text-xs text-zinc-400">
                      Model it is tuned for
                      <input
                        name="targetModel"
                        defaultValue={prompt.target_model ?? ''}
                        maxLength={200}
                        className="field"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1 text-xs text-zinc-400">
                    Prompt
                    <textarea
                      name="body"
                      defaultValue={prompt.body}
                      required
                      rows={4}
                      maxLength={32000}
                      className="field"
                    />
                  </label>
                  <label className="block space-y-1 text-xs text-zinc-400">
                    Notes
                    <input name="notes" defaultValue={prompt.notes ?? ''} maxLength={2000} className="field" />
                  </label>
                  <div className="flex items-center justify-between gap-3">
                    <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                    <DangerButton
                      label="Delete"
                      confirmLabel="Really delete"
                      action={deletePrompt.bind(null, prompt.id)}
                    />
                  </div>
                </ActionForm>
              </div>
            </details>
          ))
        )}
      </section>
    </div>
  );
}
