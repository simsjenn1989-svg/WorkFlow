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

## A design holds artwork per placement

A tee with a big front graphic and different back text is one design, not two. Artwork lives
in `design_artworks`, keyed by a placement label (`front`, `back`, `sleeve`, …), one row per
placement. Rendering matches an artwork to a print area by that label.

There is deliberately **no fallback**. An area labelled `back` on a design with only front
art is refused with a message, rather than quietly printing the front graphic twice — which
is the exact mistake this model exists to prevent, and which would be easy to miss in a
batch of fifty renders.

`designs.raw_image_path` and `print_ready_path` are gone. Keeping them as a "primary image"
beside the artwork table would have been two sources of truth for the same thing. The board
thumbnail is the design's front artwork, or its first if it has no front.

Generation targets a placement too, and can be pointed at an existing design, which is how
a back print joins a design that already has a front. Variants remember which placement
they were generated for, so choosing one replaces only that artwork.

## Batch rendering

A run is a set of design × mockup pairs, one row each in `renders`. A pair whose design has
no artwork for one of the mockup's print areas is **skipped and listed**, never part-rendered
— a listing image silently missing its back print is the kind of thing nobody notices until
it is live. The skip count and its reasons are shown before the run starts, not after.

Mockups are chosen rather than assumed, because single-sided and double-sided products are
run as separate passes.

`POST /api/renders/run` renders exactly **one** pair per request. A batch of fifty would
never finish inside a serverless function's time limit, and one long call that dies halfway
leaves nothing to resume from. One row per invocation keeps every call short and makes a
batch restartable: the client calls again while anything is still queued.

A unique index on `(design_id, mockup_template_id)` means re-running a pair replaces its
previous render instead of accumulating near-identical files.

Output is full resolution, since these become listing images. A design with at least one
finished render moves to `mockups_done`.

## Pins

The Pin Maker ported from `legacy/pin-tool/index.html`, working from finished renders rather
than manual uploads. The measuring and drawing maths is carried over unchanged — the
auto-shrink loop, the gap ratios, the CTA pill proportions, the per-layout geometry. Those
numbers came from using the tool; re-deriving them would mean re-learning them.

Drawing happens on a **canvas in the browser**, unlike mockups which render server-side.
Laying out wrapped, letter-spaced, auto-shrinking text is native to a canvas and absent from
`sharp`, the pin redraws instantly as you type, and it costs nothing to produce. The finished
image goes from canvas straight to storage over a signed URL; only small JSON reaches the
server.

The source render is fetched as a **blob** rather than set as an `<img src>`. A blob URL is
same-origin, so the canvas is never tainted and `toBlob` still works — a cross-origin image
would silently make export throw.

Themes change colours only. Templates hold a whole look — size, layout, type and colours —
and are yours to save. The migration deliberately seeds none: shipping templates named after
the themes put two identically-named buttons on one screen doing different things.

### Framing

Drag the photo to reposition it, scroll on the preview to zoom — both as the original had.
The wheel listener is attached directly rather than through React's `onWheel`, because React
registers wheel listeners as **passive** and a passive listener cannot call `preventDefault`.
Without it the page scrolls away under the cursor while you are trying to resize the photo.

## Pin copy

`SYSTEM_PROMPT` is carried over verbatim from the original tool — the bad/good examples are
what stop a model narrating the image or writing blog headlines instead of selling a
product, and that tuning is not re-derivable. One sentence changed: it opened "The image
only tells you WHAT the product is", because the old tool sent a downscaled photo. Here the
product is described in words, so that clause would be a lie to the model.

Atlas writes the copy by default. Claude models join the same picker when
`ANTHROPIC_API_KEY` is set — worth having, because the starred headlines were collected from
Claude's output and are fed back as style examples. Both providers are one HTTP call
returning JSON, so neither is more to maintain.

Starred headlines live in `style_examples` rather than `localStorage`, so one cache clear no
longer loses the voice the copy was learning.

### Two things measured, not assumed

**Token budget.** Several Atlas models think before answering and the thinking comes out of
the same budget. On the real prompt DeepSeek spent between 579 and 1373 reasoning tokens for
a 750-character answer, so a 1400 budget truncated it to nothing *sometimes* — the worst kind
of bug. The budget is 3000, and a reply that still stops on `length` is retried once at 6000.

**The mockup's tags are not product facts.** They describe the photograph — its scene, props
and season — not the garment. Passing them in made the copy advertise a "Christmas tee"
because the shirt was photographed beside a tree. Only the design's own title, tags and
prompt describe the product.

### Custom fonts

Uploaded fonts are stored, not just loaded into the page. The original warned that custom
fonts "need re-loading each time you open the app"; storing the file means a brand font is
added once. Every stored font is registered with `FontFace` before the first draw, because a
canvas can only draw a family the document has actually loaded — without that a pin set to a
custom font falls back to a system face silently.

### CSV export

Carried over as it was: a UTF-8 BOM so Excel doesn't mangle accents, CRLF line endings,
doubled quotes inside quoted fields, and the file name as the first column — the images and
the text reach Pinterest separately, so the file is read beside the downloaded images.

### Remembering settings

The studio stores the pin style and the copy settings in `localStorage`, as the original
did. Only *settings* are kept — the headline, the chosen render and the Pinterest fields
belong to one pin, so reopening the studio does not re-apply the last pin's words to the
next one.

Stored values are read **after mounting**, not in the initial state. This component renders
on the server too, so seeding state from `localStorage` would make the server's HTML and the
browser's first render disagree, which React reports as a hydration error. The save effect
is guarded on a `restored` flag for the same reason: without it the first save would
overwrite the stored style with the defaults that rendered a moment before it was read.

Keys carry a version (`workflow.pin.style.v1`). If a stored shape ever stops matching the
code, bumping the version beats migrating whatever sits in a browser somewhere.
