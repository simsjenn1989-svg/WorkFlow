/**
 * The pipeline. Every design sits at exactly one stage, and the whole app is organised
 * around moving designs rightward. See docs/SPEC.md §1.
 */

export const STAGES = [
  'idea',
  'generated',
  'approved',
  'print_ready',
  'mockups_done',
  'assets_done',
  'pushed',
  'polished',
  'published',
] as const;

export const TERMINAL_STAGES = ['rejected', 'archived'] as const;

export type Stage = (typeof STAGES)[number] | (typeof TERMINAL_STAGES)[number];

export const ALL_STAGES: readonly Stage[] = [...STAGES, ...TERMINAL_STAGES];

type StageMeta = {
  label: string;
  /** Shown on the board column header, so the next action is never a guess. */
  hint: string;
  /** Tailwind classes for the column accent. */
  accent: string;
  /** True when reaching this stage costs money. */
  paid?: boolean;
  /** Phase that implements the work leading out of this stage. */
  phase?: number;
};

export const STAGE_META: Record<Stage, StageMeta> = {
  idea: {
    label: 'Idea',
    hint: 'A prompt, not yet generated',
    accent: 'bg-slate-500',
    phase: 2,
  },
  generated: {
    label: 'Generated',
    hint: 'Pick the keeper',
    accent: 'bg-violet-500',
    paid: true,
    phase: 2,
  },
  approved: {
    label: 'Approved',
    // Was "Ready to make print-ready", which described a step that no longer exists: the
    // print canvas is built the moment a keeper is picked, and the push rebuilds it if the
    // preset's print area has changed. There is nothing to do between here and rendering
    // or pushing.
    hint: 'Render mockups, or push a draft',
    accent: 'bg-blue-500',
    phase: 2,
  },
  print_ready: {
    label: 'Print ready',
    // Kept for designs that were put here before approving did the sizing. Nothing moves a
    // design here now and nothing needs to.
    hint: 'Nothing to do — sizing happens at approval',
    accent: 'bg-cyan-500',
    phase: 3,
  },
  mockups_done: {
    label: 'Mockups done',
    hint: 'Make pins and video',
    accent: 'bg-teal-500',
    phase: 5,
  },
  assets_done: {
    label: 'Assets done',
    hint: 'Ready to push to Printify',
    accent: 'bg-emerald-500',
    phase: 4,
  },
  pushed: {
    label: 'Pushed',
    hint: 'Draft in Printify — ready for polish',
    accent: 'bg-lime-500',
    phase: 4,
  },
  polished: {
    label: 'Polished',
    hint: 'Your turn: review and publish',
    accent: 'bg-amber-500',
  },
  published: {
    label: 'Published',
    hint: 'Live',
    accent: 'bg-green-600',
  },
  rejected: { label: 'Rejected', hint: 'Not going forward', accent: 'bg-rose-600' },
  archived: { label: 'Archived', hint: 'Out of the way', accent: 'bg-zinc-600' },
};

/** The stage a design moves to when you advance it, or null at the end of the line. */
export function nextStage(stage: Stage): Stage | null {
  const i = (STAGES as readonly string[]).indexOf(stage);
  if (i === -1) return null; // rejected / archived do not advance
  return STAGES[i + 1] ?? null;
}

export function previousStage(stage: Stage): Stage | null {
  const i = (STAGES as readonly string[]).indexOf(stage);
  if (i <= 0) return null;
  return STAGES[i - 1] ?? null;
}

export function isStage(v: string): v is Stage {
  return (ALL_STAGES as readonly string[]).includes(v);
}

/** "3 days", "4 hours", "just now" — for how long a card has sat where it is. */
export function timeIn(since: string | Date): string {
  const ms = Date.now() - new Date(since).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'}`;
}
