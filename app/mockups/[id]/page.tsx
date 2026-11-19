import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isConfigured } from '@/lib/supabase';
import { getMockup } from '@/lib/mockups';
import { boardData } from '@/lib/data';
import { deleteMockup } from '../actions';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { DangerButton } from '@/components/DangerButton';
import { AreaEditor } from './AreaEditor';
import type { DesignCard } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MockupPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured) return <SetupNotice />;

  const { id } = await params;
  const template = await getMockup(id);
  if (!template) notFound();

  // Only designs that actually have artwork can be previewed.
  const board = await boardData();
  const designs: DesignCard[] = Object.values(board)
    .flat()
    .filter((d) => d.image_url)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-5 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <Link href="/mockups" className="hover:text-zinc-300">
            ← Mockups
          </Link>
          <span>·</span>
          <span className="text-zinc-400">{template.name}</span>
        </div>
        <DangerButton
          label="Delete mockup"
          confirmLabel="Really delete"
          action={deleteMockup.bind(null, template.id)}
          onDone="/mockups"
        />
      </div>

      <AreaEditor template={template} designs={designs} />
    </div>
  );
}
