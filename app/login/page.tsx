import { isAuthConfigured } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-xs space-y-5">
        <div className="space-y-1 text-center">
          <h1 className="text-base font-semibold">WorkFlow</h1>
          <p className="text-xs text-zinc-500">This board is private.</p>
        </div>

        {isAuthConfigured() ? (
          <LoginForm next={next ?? ''} />
        ) : (
          <p className="rounded-md border border-amber-900/60 bg-amber-950/40 p-3 text-xs leading-relaxed text-amber-200">
            <strong className="font-semibold">APP_PASSWORD is not set.</strong> Until it is, nobody
            can sign in — the app refuses access rather than letting everyone through.
          </p>
        )}
      </div>
    </div>
  );
}
