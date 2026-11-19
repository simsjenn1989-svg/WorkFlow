/**
 * Shown instead of a crash when Supabase is not configured yet. The app is useless without a
 * database, so this explains exactly what to do rather than throwing a stack trace.
 */
export function SetupNotice() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 py-12">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Connect a database to get started</h1>
        <p className="text-sm leading-relaxed text-zinc-400">
          WorkFlow stores designs, collections and files in Supabase. Two environment
          variables are needed, then the app works.
        </p>
      </div>

      <ol className="space-y-5 text-sm text-zinc-300">
        <li className="space-y-2">
          <p className="font-medium">1. Create a Supabase project</p>
          <p className="text-zinc-400">
            Any region. Note the project URL and the <em>service role</em> key from Project
            Settings → API.
          </p>
        </li>

        <li className="space-y-2">
          <p className="font-medium">2. Run the migrations</p>
          <p className="text-zinc-400">
            Paste the contents of <code className="text-zinc-300">supabase/migrations/0001_init.sql</code>{' '}
            and then <code className="text-zinc-300">0002_storage.sql</code> into the SQL editor and
            run them. The first creates the tables, the second the private storage bucket.
          </p>
        </li>

        <li className="space-y-2">
          <p className="font-medium">3. Set the variables</p>
          <p className="text-zinc-400">
            Copy <code className="text-zinc-300">.env.example</code> to{' '}
            <code className="text-zinc-300">.env.local</code> and fill in:
          </p>
          <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300">
            {`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...`}
          </pre>
          <p className="text-xs text-zinc-500">
            The service role key bypasses row-level security, so it stays on the server. It is
            never sent to the browser, and <code>.env.local</code> is gitignored.
          </p>
        </li>
      </ol>

      <p className="border-t border-zinc-900 pt-4 text-xs text-zinc-500">
        Restart the dev server after setting the variables.
      </p>
    </div>
  );
}
