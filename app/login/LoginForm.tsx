'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { logIn, type LoginResult } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(logIn, { error: '' } satisfies LoginResult);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        className="field"
        placeholder="Password"
        autoFocus
        autoComplete="current-password"
        required
      />
      <Submit />
      {state.error ? (
        <p className="text-center text-xs text-rose-400" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Checking…' : 'Sign in'}
    </button>
  );
}
