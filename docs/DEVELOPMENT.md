# Running WorkFlow

## Supabase

The project is **WorkFlow** (`uvwsxjxvgwvndpvzkozk`), region `us-west-2`, in the WorkFlow
organization. Migrations in `supabase/migrations/` have all been applied to it:

| Migration | What it does |
|---|---|
| `0001_init.sql` | every table, enum, index and trigger |
| `0002_storage.sql` | the private `workflow` storage bucket |
| `0003_grants.sql` | grants the service role table privileges |

`0003` is not optional. Tables created by a migration do not inherit Supabase's default
privileges unless the creating role is the one those defaults hang off, so without it every
query fails with `permission denied for table designs` — before RLS is even consulted. Only
`service_role` is granted; `anon` and `authenticated` are explicitly revoked, so a leaked
publishable key reads nothing even if a policy is later added by mistake.

## Environment variables

Copy `.env.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://uvwsxjxvgwvndpvzkozk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<the service_role key from the project's API Keys page>
```

The service role key bypasses RLS, so it is server-only and `.env.local` is gitignored.

## Running locally

```bash
npm install
npm run dev
```

## Running inside a Claude cloud session

Two differences, both environmental — no application code depends on them.

**Node must be told about the egress proxy.** Node's `fetch` ignores `HTTPS_PROXY`, so
without this it cannot even resolve the Supabase host, and every page fails with
`TypeError: fetch failed`. `NODE_OPTIONS` does not survive into Next's server process, so the
flag goes on `node` directly:

```bash
NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  node --use-env-proxy node_modules/next/dist/bin/next start -p 3100
```

**The service role key is a network secret, not a variable.** In the cloud session the real
key is injected into the `Authorization` header by the proxy, so `.env.local` there holds the
*publishable* key purely to satisfy the API gateway's `apikey` header. That file must never be
copied to Vercel.

**Driving the app with Playwright** needs the proxy too, with localhost bypassed — otherwise
the browser proxies `localhost:3100` as well and the page never loads at all:

```js
chromium.launch({ proxy: { server: 'http://127.0.0.1:38173', bypass: 'localhost,127.0.0.1' } })
```

## Deploying to Vercel

Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the project's environment
variables, using the **real** service role key. None of the proxy workarounds above apply.

## Notes

- `/` and `/collections` are `force-dynamic`. They read live data, so a build-time snapshot
  would be both stale and impossible to produce without network access at build time.
- Images are served through short-lived signed URLs, which is why the app uses plain `<img>`
  rather than `next/image` — the latter would cache a URL past its expiry.
