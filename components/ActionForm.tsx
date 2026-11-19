'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/actions';

type State = { ok: boolean; error: string | null };

const initial: State = { ok: false, error: null };

/**
 * A form around a server action that returns an ActionResult.
 *
 * `<form action={fn}>` on its own requires the action to return void, which would mean
 * discarding the error message. This keeps the plain-form behaviour (works without JS,
 * React resets the fields on success) while still showing what went wrong.
 */
export function ActionForm({
  action,
  children,
  className,
  errorClassName,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  errorClassName?: string;
}) {
  const [state, formAction] = useActionState(async (_prev: State, form: FormData): Promise<State> => {
    const result = await action(form);
    return result.ok ? { ok: true, error: null } : { ok: false, error: result.error };
  }, initial);

  return (
    <form action={formAction} className={className}>
      {children}
      {state.error ? (
        <p className={`text-xs text-rose-400 ${errorClassName ?? ''}`} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
