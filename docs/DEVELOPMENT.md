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

## Atlas Cloud (phase 2)

Verified against the live API, not written from docs:

| | |
|---|---|
| Start | `POST https://api.atlascloud.ai/api/v1/model/generateImage` → `{ data: { id, status } }` |
| Poll | `GET https://api.atlascloud.ai/api/v1/model/prediction/{id}` |
| Statuses | `created`, `processing`, `completed`, `failed` |
| Auth | `Authorization: Bearer <ATLAS_CLOUD_API_KEY>` |
| Catalogue | `GET /api/v1/models` — public, no key, 626 models |
| Per-model schema | each catalogue entry carries a `schema` URL on `static.atlascloud.ai` |
| Finished images | served from `atlas-media.oss-us-west-1.aliyuncs.com` |

Four hosts, not one. The app downloads every output into Supabase storage rather than
linking it, because those media URLs are not promised to last.

The model picker and the settings form are both built from the live catalogue and each
model's published OpenAPI schema, so new Atlas models appear without a code change.

Generation takes roughly twenty seconds, which is too long to hold a serverless function
open. `POST /api/generate` only starts the job and records it; `GET /api/generate/{id}`
collects the result and is idempotent, so polling twice cannot duplicate variants or
double-charge the ledger.

### Driving the app with Playwright here

Launch Chromium **without** a proxy. Routing it through the egress proxy currently fails
with `ERR_PROXY_CONNECTION_FAILED` on Supabase storage, which looks exactly like broken
images in the app but is not — the same URLs return 200 to `curl`, to Node, and to a
browser launched with no proxy.

## Uploads go straight to storage

File bytes never pass through the server. The browser asks `/api/uploads/sign` for a
one-shot signed URL, PUTs the file to Supabase storage directly, then calls `/api/designs`
or `/api/mockups` with a small JSON body to register the row.

This is not a refinement. Server Actions cap a request body at **1 MB**, and Vercel caps a
serverless function request at about 4.5 MB, so routing real photographs through either
fails: three garment photos totalling 1.2 MB returned a 413 that surfaced only as a React
error in the console. Raising `serverActions.bodySizeLimit` would not have helped past
Vercel's own limit.

The service-role key still never reaches the browser — a signed upload URL authorises
exactly one object and nothing else.

## Mockups

A template is a garment photograph plus four corners stored as fractions of the image, so an
area survives any later resize. Saving an area measures the garment colour and baseline
luminance underneath it and stores both on the template.

Degenerate areas are rejected on both save and preview. Four corners dragged onto nearly the
same line otherwise saves happily and renders nothing at all, which reads as a broken
renderer rather than a badly marked area.

### Testing the editor with Playwright

Two traps, both of which produced convincing false failures:

- `locator.boundingBox()` scrolls the element into view, shifting the page between measuring
  and clicking. Read the rect with `page.evaluate` instead.
- Don't assume handles start at their defaults. A template with a saved area loads its own
  corners, so a grab at the default position lands on empty image and nothing moves.

### Several print areas per mockup

A template carries a list of areas, each with a label, four corners, and its own measured
garment colour and baseline. A photo showing the front and back together takes two, each
assigned a different design.

Measuring per area rather than per template is not a nicety. On the front-and-back photo the
two halves measure `#232024` baseline 33 and `#2f2b2e` baseline 38 — different enough that a
single baseline would under- or over-shade one of them.

The compositor reads the garment from an untouched copy of the resized photo while writing
into the output, so overlapping areas cannot compound each other's shading.

### Adjusting a print after rendering

Corners alone can express any shape, but nudging a print up by a few millimetres means
moving four of them by exactly the same amount — fiddly enough that it stops being worth
doing. So an area can also be moved, scaled and rotated as a whole: drag inside it, use the
arrow keys (shift for finer steps), or the Move / Size / Rotate controls.

The guides stay drawn over the rendered image rather than only over the bare photo, and an
adjustment schedules a re-render about half a second later, so the thing being positioned is
the real output rather than an outline.

Coordinates are fractions of the image, so x and y are not the same length on screen. Moving
and scaling are unaffected — both axes take the same factor either way — but rotation is, so
`rotateQuad` converts to a square space, turns, and converts back. Without that, rotating on
a 4:3 photo shears the area instead of turning it.
