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

### Pin variants

A pin can hold several text variants of the same image — posting a listing to Pinterest a
few times with different headlines is how it gets tested. A variant carries the words and
the framing; the style is shared across the set, the same split the original drew between
its per-image items and its global style object.

**Save all** renders each variant on a canvas of its own rather than flicking the preview
through them and waiting for React to settle between each. `drawPin` is deterministic, so an
off-screen draw is identical to what is on screen.

**Make N variants** on the copy panel turns a whole set of generated headlines into one
variant each, keeping the current framing. Generate five headlines, make five pins, save them
all — which is the workflow the copy generation existed for.

## Phase 4 — Printify drafts

### What the catalogue actually says

Measured against the live account before any of this was written, not taken from docs:

| | |
|---|---|
| Blueprint | **706** — Comfort Colors® 1717 Unisex Garment-Dyed T-shirt |
| Print provider | **99** — Printify Choice |
| Variants | 378 for that pair, 56 colours; **7 in Black**: S, M, L, XL, 2XL, 3XL, 4XL |
| Print areas | named exactly `front` and `back` — the same words the artwork labels already use, so nothing has to be translated |
| Print area size | **varies by variant**: S is 3703 × 4200, M is 4107 × 4658, **L through 4XL are 4494 × 5097** |

That last row is the one to remember. A single print file is shared by every variant, so it
has to be made for the **largest** placeholder or the big sizes print a scaled-up file.
4494 × 5097 at 300 DPI is 15.0 × 17.0 inches.

The shop's own live Comfort Colors product supplied the price ladder, read off it rather
than invented: S–XL $36.99, 2XL $37.99, 3XL $41.99, 4XL $45.99. Its placements are in the
same normalised units this app uses — `x`/`y` are the image centre across the print area and
`scale: 1` fills its width; the back print sat at x 0.5, y 0.45, scale 1, which is where
`DEFAULT_PLACEMENT` comes from.

### Drafts, and why `visible: false`

Not calling `POST /v1/shops/{id}/products/{id}/publish.json` is already enough to keep a
product off Etsy and TikTok, and there is no code path to that endpoint anywhere in the app.
But a product created by POST comes back with `visible: true`, so it shows as active in
Printify's own product list. Sending `visible: false` on create is honoured — measured: a
PUT with `visible: false` returns `visible: false` — so `createProduct` sets it, and a
re-push leaves the field alone in case a product has since been published by hand.

### The upscaler drops transparency

Atlas returns designs at 1024 × 1024. Reaching 4494 means roughly a 4× enlargement, and
Atlas sells exactly that: `atlascloud/image-upscaler`, $0.01, "texture-aware enhancement for
print".

It also **discards the alpha channel**. A 1024 PNG with a clean transparent background comes
back as 4096 RGB with that background flattened to near-black — measured at (1, 1, 1) in
every corner. Uploaded to Printify as-is, every design prints as a black rectangle covering
the whole print area. Nothing about the build or the API response would have said so.

`upscaleWithAtlas` therefore re-attaches an alpha channel taken from the original and resized
by the same factor. Both are the same shape scaled identically, so the mask registers to the
pixel.

With that fixed, the two routes were compared on a real design:

| | sharp Lanczos3 | Atlas + restored alpha |
|---|---|---|
| Cost | free | $0.01 per placement |
| Time | instant | ~20 s |
| Size | 3.7 MB | 20.4 MB |
| Mean \|Laplacian\| (edge crispness, same crop) | 0.494 | **1.288** |

The upscaler genuinely does sharpen edges — 2.6× the edge energy — but the two images differ
by only 0.70/255 on average across the whole frame (max 18), so the gain lives in a thin band
at each edge. Lanczos is therefore the default and the upscaler is a checkbox, worth ticking
for fine lettering and not much else.

### Trimming

Print art is cropped to its opaque bounding box before enlargement. Without it, a design
generated with wide empty margins prints smaller than the placement claims, and the only way
to find out is to squint at Printify's preview. sharp's own `trim` works from a background
colour and gives up on an alpha-only edge, so the bounding box is found from the alpha
channel directly, with anything under 8/255 treated as empty.

The visible effect: the GHOST MODE design is a 1024 × 1024 file whose front art trims to
4494 × 2726 and whose back art trims to 4494 × 3331. Both fill the print area's width, which
is what `scale: 1` is supposed to mean.

### Reusing uploads

Printify keeps uploaded images indefinitely and addresses them by id, so `printify_uploads`
remembers the id per artwork along with **which file was sent**. If the print-ready file is
rebuilt — a different upscaler, a changed print area — the paths stop matching and it is
uploaded again, rather than a second product quietly printing the old version.

A print-ready file is also rebuilt when it is too small for the preset's print area. The
check is `width >= target × 0.98 **or** height >= target × 0.98`, not both: art keeps its own
aspect ratio, so it fills the print area in exactly one direction. Requiring both would
rebuild a correctly sized tall design on every single push.

### Measured end to end

One design with front and back art, pushed through the real UI against the real API: 14 s for
two 1024 → 4494 enlargements, two uploads and the product create. The draft came back
`visible: false`, 7 Black variants enabled at the right prices, both placements present at
4494 × 2726 and 4494 × 3331, and Printify generated 5 of its own mockups from it. The test
draft was deleted afterwards.

### Stale `tsconfig.tsbuildinfo`

`typedRoutes` kept rejecting `/printify` as a route long after the page existed and
`.next/types/routes.d.ts` listed it. The route types were fine; `tsconfig.tsbuildinfo` was
stale. Deleting it fixed it. Worth trying before believing a route-type error.

## Phase 7 — writing the listing

### The style is read, not written

The shop's live listings turned out to be a template rather than a vibe. Across 9 of 10
Comfort Colors listings in the TikTok shop:

- **Title** — 107 to 120 characters, four comma-separated keyword phrases, the last one always
  `Oversized Comfort Colors Gift`.
- **Tags** — exactly 13: about seven specific to the design, then a fixed tail of
  `Comfort Colors, Oversized Tee, Unisex, Gift for Her, Gift for Him, T-shirts`.
- **Description** — three short written paragraphs, then three blocks that are byte-identical
  in every listing: *Why it slaps*, *Care (yes, even chaos does laundry)*, and a size chart.

So `deriveStyle` reads the shop and keeps what most listings agree on: the shared title
suffix (60% agreement), tags carried by nearly every listing (80%), and blocks found under
the same heading in most of them. Run against the real shop it recovered all of it — the
suffix in 15 of 19, all six tail tags in the right order, all three blocks in 19 of 19.

The one piece of actual inference is the conditional line. "Printed on the front and back"
appears in every two-sided listing and in none of the one-sided ones, so it is stored with
`requires: 'both-sides'` and dropped when the product only prints on the front. It worked
from a sample of 2 two-sided listings against 17 one-sided.

`parseDescription` round-trips a real description byte-for-byte, which is the only reason to
trust what it extracted.

### The model writes less than you would think

It is asked for five things: a hook, what the design is, where to wear it, three title
phrases and seven tags. Everything else — fabric, care, measurements, the title suffix, the
six tail tags, the HTML — is assembled by `composeListing` from the stored style.

That split is deliberate. A model asked to reproduce a size chart will eventually produce a
wrong one, and a wrong measurement is a return rather than a typo.

Limits are enforced in code, not in the prompt: Etsy's 140-character title and 13 tags of at
most 20 characters each. Asking a model to respect those mostly works, and "mostly" is how a
listing gets rejected at publish time. Over-long tags are dropped rather than truncated,
because a truncated search tag matches nothing. Anything the limits forced is reported in the
editor instead of applied quietly.

Measured on the real shop with DeepSeek V4.1 Flash: 8 to 27 seconds, output indistinguishable
from the hand-written listings beside it, no adjustments needed.

### `variant_ids` on update — the bug that only shows up the second time

Creating a product with only the seven enabled variants listed in `print_areas[].variant_ids`
is accepted. Updating that same product with the same seven is rejected:

```
400 Variants do not match selected blueprint and print provider. Please make sure that all
    product variants are present in the `print_areas.*.variant_ids` field
```

So the first push worked and the re-push failed. Sending the provider's whole catalogue was
the obvious fix and it failed too: the catalogue for blueprint 706 / provider 99 holds **378**
variants, while the product Printify builds from it holds **509** — the extra 131 belong to
the blueprint's *other* print providers. The field wants the product's own set.

So: on create, send the catalogue list and let Printify expand it; on update, read the
product back and send its own `variants[].id`. The shop's hand-built listings contain all 509
in that field, which was the clue sitting in plain sight from the start.

The catalogue call is cached for ten minutes, since a run of twenty designs otherwise fetches
the same 378 records twenty times.

### Applying copy does not touch anything else

`/api/listings/apply` sends title, description and tags. It does not send `visible`, so a
product that has since been published by hand is not yanked back out of the shop by a copy
edit, and it does not send print areas, so it cannot hit the bug above. There is still no
call to Printify's publish endpoint anywhere in the app.

### Shared model plumbing

`callAtlas` and `callAnthropic` moved to `lib/copy/models.ts` when listing copy became a
second caller. The gotchas they carry — no `temperature` for Claude 5.5, `effort: 'low'`
because thinking comes out of `max_tokens`, a 3000-token budget with one retry at 6000 —
now exist once rather than twice. `lib/copy/generate.ts` went from about 160 lines to 54, and
the pin copy panel was re-tested afterwards.

## Phase 6 — UGC video

### The framing is the whole problem

The renders are landscape — measured at 2000x1500 and 2000x1600, so 1.33 and 1.25. TikTok
wants 9:16, which is 0.5625. Nothing about that reconciles itself.

What makes it structural rather than cosmetic: **most image-to-video models take their aspect
ratio from the frame they are given.** Seedance 2.5 offers only `ratio: adaptive`; Wan 3.0 has
no ratio field at all; of the catalogue, only a minority expose `aspect_ratio`. Hand any of
them a landscape still and a landscape clip comes back. So the vertical crop is not post-
processing, it is the input that decides the output's shape, and it has to happen before a
cent is spent.

Three framings, compared on a real render:

| | kept | verdict |
|---|---|---|
| **Crop** | 42% of the photo | Reads as a native phone shot. The default. |
| **Fill** | 100%, blurred bars | Keeps the whole scene but spends most of the frame on blur. |
| **As is** | 100% | Landscape clip. There when the destination is not TikTok. |

The crop is centred on the **print area**, not on the middle of the photo, using the corners
the mockup template already stores. On a lifestyle shot where the model stands off-centre
that is the difference between a video of the shirt and a video of a Christmas tree. Sliders
nudge it, and the preview endpoint returns the exact JPEG that would be sent, so the framing
is settled by looking rather than by paying.

### Two pricing units, and a rounding bug worth the whole section

Of 139 image-to-video models, **32 price per second** and 107 price per clip. Quoting a
10-second clip from a per-second model as if it were per-clip under-reports by 10x, so the
unit is read from the catalogue and the duration multiplied in.

The sharper one: three models cost **less than a cent** — $0.002, $0.007 a second, $0.009.
The first version rounded the estimate to the nearest cent, so those quoted as **$0.00**. The
screen offered them as free, the ledger would have recorded nothing, and the monthly ceiling
would never have moved however many were generated. Estimates now round **up**, which
over-records by a fraction of a cent — the safe direction for a spending limit — and the real
figure is shown to three decimals next to it.

A related one found at the same time: sorting the list cheapest-first put the $0.002 model at
the top, which made the default selection the one the screen was least able to quote. Unpriced
models now sort last.

### A transient poll must not kill a finished clip

A test run came back as `failed` with a bare `fetch failed`. Atlas had in fact produced the
video — the mp4 was sitting on its media host, complete and downloadable — and polling again
collected it without complaint. One blip on one of three different hosts had thrown away a
clip that was finished and already paid for.

So a thrown poll no longer fails the row. It records the message, leaves the status running,
and the client tries again; only after 15 minutes does it become a real failure. The error
text now names which of the three fetches broke, because Node's `fetch failed` on its own
says nothing and the reason is hidden in `cause`.

### Measured end to end

`bytedance/seedance-v1-pro-fast/image-to-video`, 5 seconds, $0.009: out came **480x864 —
exactly 9:16 — 5.04 s at 24 fps**, the model shifting and smiling with a slight camera pull-
out, the print readable and undistorted throughout. Roughly 40 seconds start to finish.

Worth knowing for prompting: the model invents things that were not in the still. In the test
clip a camera appears in her hands by the last second. That is inherent to image-to-video, not
a fault in the pipeline, and it is the reason the motion prompt is a saved, reusable shot
rather than something retyped each time.

### A clip that was never collected

Reported from real use: a generation started and "nothing ever landed in the app". Three
separate defects, found by reading the row rather than guessing.

**What actually went wrong at Atlas.** The job was submitted fine and then polling returned
`400 InvalidEndpoint.ClosedEndpoint` — Atlas had taken that model's endpoint out of service
while the job was in flight. Nothing to do with the missing prompt that was suspected; that
model does not require one, and the endpoint accepted new submissions again minutes later.

**Why the screen showed nothing.** `VideoList` rendered only finished and failed clips, so a
row sitting at `running` appeared nowhere at all. In-flight clips are now a section of their
own with their age, the last error if there was one, and a check button.

**Why it never resolved itself.** Nothing re-polled after the page was left. The sidebar even
said "You can leave this page — the clip appears below when it is done", which was simply
false: the only poller was the loop in the component that started the job. The list now
resumes any in-flight row when the page opens, which is what makes that sentence true.

**Why a permanent error waited fifteen minutes.** The retry window added earlier — right for
a dropped connection — was applied to every thrown poll, including an HTTP 400. A 4xx is an
answer, not a blip, so it now fails immediately; `isPermanent` also catches `ClosedEndpoint`
and friends by name.

A smaller one found alongside: a clip that succeeded on a second poll kept the first poll's
error text, so a perfectly good video was listed with an error beside it. Cleared on success.

### Prompts are required more often than not

Measured across 40 of the image-to-video models: **23 require a prompt, 17 do not.** The
models differ in ways their names do not hint at — `seedance-2.5` does not need one,
`seedance-v1-pro-fast` does, and so does `wan-3.0`. Leaving the motion prompt blank is
therefore fine about 40% of the time and a guaranteed rejection the rest.

The schema's `required` list is now read with its fields, the Motion heading says which kind
of model is selected, and the button is disabled with an explanation rather than submitting a
job that will bounce. Checked on the server too, since the form is not the authority.

### Letting the model do the cropping

Tried deliberately: a 4:3 landscape frame sent with `aspect_ratio: 9:16`. The result was a
true **480x864** clip. The model cropped the landscape frame to vertical itself — no
letterboxing, no squashing, no distortion — and centred on the subject rather than on the
print area, keeping her face in shot. Side by side with the app-cropped version of the same
render and model, the model's composition was the better of the two.

That is worth knowing, and it is the opposite of what the crop was built assuming. Handing
over the whole scene gives the model everything to compose from; cropping here first hands it
a 42% slice chosen around the graphic. So the two paths are:

- **Crop here** — deterministic, centred on the print area, previewed for free before paying.
- **As is + `aspect_ratio: 9:16`** — the model composes, often better, but you cannot see
  where it will cut until it is made, and nothing guarantees the design stays in frame.

Neither is right in general, so the app offers both and explains the trade rather than
forcing the frame and the aspect ratio to agree. An earlier instinct to "fix" the mismatch
automatically would have removed a technique that turns out to be useful.

This only works where the model publishes a vertical option: of 45 sampled, 32 expose
`aspect_ratio` or `ratio`, but 6 of those offer only `adaptive`, which just copies the input's
shape. The panel now says which case the selected model is in, and says nothing about setting
a value that model does not offer.

Also fixed alongside: `original` framing was enlarging a 2000x1500 render to 2560x1920 — a
third more bytes over the wire for detail that was never there.

### Model bake-off: nine models, one frame, $0.71

Nine image-to-video models run against the same cropped 9:16 frame and the same motion
prompt, to rank them on what this shop actually needs: **does the printed graphic survive**.

**Durations are not free numbers.** Three of the nine failed outright with
`Request parameters are invalid` — Veo 3.1 accepts a `duration` of only **4, 6 or 8**, and 5
was being sent. The Seconds control was a free 1–60 number box; most models publish an exact
enum (Veo `[4,6,8]`, Seedance 2.5 `[4,5,...,30]`, Wan 3.0 `[2,3,...,30]`). It is now a select
built from the model's own list, with a server-side check that names the allowed values
instead of relaying Atlas's unhelpful message.

**Print integrity, judged from the first and last frames side by side:**

| | Model | 5s | print after 5 seconds |
|---|---|---|---|
| ✅ | seedance-v1-pro-fast | $0.009 | square, sharp, barely moves |
| ✅ | veo3.1-lite | $0.050 | square, crisp |
| ✅ | veo3.1-fast | $0.080 | square, crisp |
| ✅ | veo3.1 | $0.200 | square, crisp |
| ~ | seedance-2.0-fast | $0.072 | slight skew, readable |
| ~ | seedance-2.0 | $0.090 | slight skew, softening |
| ❌ | seedance-2.0-mini | $0.045 | rotated and skewed |
| ❌ | ltx-2.3-fast | $0.030 | rotated ~15°, blurred |
| ❌ | ltx-2.5-pro | $0.120 | rotated, blurred |

**Price does not predict print integrity.** The $0.009 model held the graphic as well as the
$0.200 one, and the $0.120 LTX was among the worst.

**Automatic metrics were not enough.** Mean Laplacian in the print region ranked
seedance-v1-pro-fast at "131% of its starting sharpness", which sounded like degradation and
was actually the camera pushing in on an undistorted print. Frame drift ranked it mid-table
because it measured camera movement, not warp. The visual comparison reversed both readings —
worth remembering before trusting a number over a look.

**Motion character differs more than quality does.** Every Veo model invented the same
unprompted gesture: the subject grabs the shirt with both hands and tugs it. That is a real
UGC convention for clothing and may be wanted, but the hands cross the graphic while they do
it. Seedance v1 Pro Fast kept hands out of frame and simply let her turn and smile. (It is not
immune — under a different prompt it put a camera in her hands — so the motion prompt matters
as much as the model.)

### Deleting a design left most of its files behind

Found when looking for test designs to remove: the bucket held **65 files, 70 MB, of which 40
files and 46 MB were orphaned** — nothing in the database pointed at them.

Two causes, both in one short function.

`deleteDesign` listed `designs/{id}` and removed what came back. Supabase storage has no
folders — a path is a name with slashes — and `list` returns one level, with a prefix showing
up as an entry whose `id` is null. So `variants/` and `print-ready/` appeared as two entries,
`remove` was called on them as if they were files, and every PNG inside survived.

Worse, it only ever considered the design's own folder. Renders, pins and videos reference
`design_id` with `on delete cascade`, so deleting one design silently removed **16 video rows,
4 render rows and 5 pin rows** — and not one of their files. Deleting a single test design
accounted for nearly all 46 MB.

The fix is ordering as much as recursion: the file list is gathered **before** the row is
deleted, because the cascade destroys the only record of which files belonged to what.
`listRecursive` walks prefixes properly, and `filesOwnedByDesign` collects the design's folder
plus the output of every render, pin and clip made from it.

The design page now also says what a delete will take — "4 renders, 1 clip and their files" —
and notes that a Printify draft stays in the shop, because that lives in someone else's system
and the app has no business deleting it silently.

`findOrphans` sweeps the bucket against every path column in every table, for cleaning up what
was already lost. It returns the list rather than deleting it: "no row points at this" is a
strong claim, and acting on it should be a decision.

### The estimate was eleven times under

Reported as a 520 error on the Generate screen. Two problems behind it, and the error was the
smaller one.

**The charge.** Two 2160x3840 images at quality `high` from `gpt-image-2.6-flare` were quoted
at **$0.014** — listed base price times image count — and Atlas charged **$0.16168**. Size and
quality tier multiply the base by a factor the catalogue does not publish, so the estimate was
not slightly optimistic, it was wrong by 11x, and the monthly ceiling it guards was wrong by
the same amount.

The finished prediction carries the truth: `price` and `charge_status` arrive on the record
once the work completes. The ledger now records that figure and falls back to the estimate
only when Atlas has not said. The Generate screen says "from $0.01" rather than "$0.01", and
flags a large size or a high quality tier as something that multiplies it.

The estimate still guards the budget before the run, because something has to, but it is
presented as a floor.

**The error.** Atlas completed the generation, produced both images and charged for them; one
download came back 520 and the job was marked permanently failed. Work that existed and had
been paid for was thrown away, and polling again collected it in full — all three variants,
2160x3840, transparency intact.

Same mistake as the video poll earlier in this document: a thrown collection is not a failed
generation. The job now stays running on a thrown download and the client retries, with a
fifteen minute window before it counts as real. Worth noticing that this class of bug has now
appeared three times in three different pollers, each written separately.

### The policy, not the pipeline

Two separate pollers had made the same wrong call — a thrown download treated as the work
having failed, discarding output that was finished and paid for. The tempting fix is one
shared "collect a prediction" function. That was not done: the image poller and the video
poller download different things into different tables, and forcing them together would
produce an abstraction that fits neither.

What they actually share is a judgement, so only that moved, into `lib/collect.ts`:
`isPermanentFailure` (a 4xx is an answer; a reset is a blip) and `judgeFailure` (plus a
fifteen-minute window so a service that keeps dropping the connection is eventually called a
failure). About twenty lines, no restructuring, and the next thing that polls something
inherits the right behaviour without being forced into a shape.

Checked against every error string this session actually produced: `fetch failed`,
`HTTP 520 error` and `Request was cancelled` retry; `400 Request parameters are invalid`,
`InvalidEndpoint.ClosedEndpoint` and `401 Unauthorized` give up.

### The retry introduced a duplicate

Retrying a collection turned out to re-download outputs that had already been stored. The
recovered raccoon generation made two images and left **three** variant rows — two of them
byte-identical — plus an orphaned file from the first attempt.

The fix needed nothing new: the output's position was already recorded in `params.index` when
it was stored, so the loop reads what exists and skips it. Worth noting that the bug was
created by the previous fix and only showed up because the storage audit counted one more
orphan than expected.

### An orphan draft in someone else's shop

`printify/push` created the product at Printify and then wrote the id to the database. A
throw in between — a dropped response, a failed write — marked the row failed with no id, so
a real draft existed in the shop that the app did not know about, and the next push created a
**second** one, because `existingProductId` was still null.

Not lost money, and worse than a failed row in one respect: a failed row is visible, a
duplicate draft is not. `pushDesign` now takes an `onProductCreated` callback invoked the
instant Printify returns an id, and the catch deliberately leaves that id in place so a retry
updates the draft rather than making another.

### Sweeping the orphans

40 unreferenced files, 46.04 MB, removed. The bucket went from 59 files / 84.3 MB to **18
files / 30.4 MB** — the 15 mockup photos, 2 live design variants and 1 font, which is
everything that should be there.

Checking the checker first was the part that mattered. `findOrphans` compares the bucket
against a hardcoded list of path columns, so a column missing from that list means deleting a
file something still points at. The list was verified against the database rather than
memory:

```sql
select table_name, column_name from information_schema.columns
where table_schema = 'public' and column_name like '%path%';
```

Ten columns across eight tables — and `printify_uploads.source_path` was **missing** from the
first version. Nothing would have been lost in this particular sweep (the same files are
reachable through `design_artworks.print_ready_path`), but the gap would have mattered the
moment those two diverged. The query is now in a comment above the list.

Also worth recording: sampling rows to discover columns does not work, because a table with
no rows returns no column names, and an empty table is exactly the kind that gets forgotten.
The schema has to be asked, not inferred.

### Placement: from fixed coordinates to measured geometry

A preset held `x`, `y`, `scale`, `angle` and applied them to every design alike. Because `y`
is the image CENTRE, that put a short wordmark and a tall badge at visibly different heights
on the chest — the taller the art, the higher its top edge crept. What stays constant on a
rail of shirts is the TOP of the print, so that is what is held fixed now and the centre is
derived from it (`lib/printify/geometry.ts`).

The preset's placement entries therefore stopped being coordinates and became rules:
`enabled`, `topDropIn`, `maxWidthIn`, `maxHeightIn`. Position is computed per design from the
trimmed art's real dimensions.

**The print area does not start at the collar.** The first version assumed it did. A real
draft pushed with a 3in drop came back with the art sitting **6.79in** below the collar on
Printify's own mockup — so the Comfort Colors 1717 front area begins about **3.79in** down.
Printify publishes the area's pixel size and nothing about where it sits on the garment, so
there was no way to know this except to push one and measure it. `collarToAreaTopIn` now
carries that measurement, `topDropIn` means "below the collar", and asking for 3in on this
blueprint clamps to 3.79in rather than failing — 3in is simply above where printing can
start. After the fix the same design measured **3.69in** below the collar, 0.02in off centre.

Two things turned out to be right already and were left alone: the push has always skipped
print areas with no artwork, and the print-ready step has always trimmed transparent padding
before upload. What the trim now also buys is that "3 inches below the collar" means the same
thing for every design, because the measured height is the art's, not its empty margins.

Worth recording about the empty back: a front-only push sends **no** back placeholder, and
Printify adds one itself with `images: []`. That looked wrong until all six of the shop's
own front-only products were checked and every one reads `back=0, front=1`. It is how
Printify represents "nothing printed here", not a second print.

### The generation that was not stuck

Reported as a card reading "No image yet" for 12+ hours. The job had finished 13.7 hours
earlier and both images were in storage, readable. The thumbnail came only from a *chosen*
keeper, so a design with two perfectly good unpicked images looked identical to one whose
generation had failed.

The card now falls back to the newest unpicked variant and says `pick 1 of 2`, and carries
the job's state when there is one: `generating` with an age, or `failed` with the error and a
Retry.

A genuine timeout went in alongside, since a job really can hang: ten minutes of Atlas still
reporting "processing" marks it failed. Nothing is written to the ledger on that path — cost
is recorded when images are collected — so a job that produced nothing has never counted
against the month, and retrying cannot double charge.

Retry reopens the Generate screen prefilled from the job's stored prompt, model and count
rather than firing a new one. Generating costs money and this app's rule is that nothing paid
runs without the price being shown and confirmed; a one-click retry would have quietly broken
that. Storing the prompt in the job payload is what makes an exact retry possible at all.

### Redrawing a reference in a named style

Give it a design you like, pick a style, get the same subject reinterpreted. Atlas calls
these image-to-image or `/edit` models, on the same `/generateImage` endpoint as
text-to-image, with the reference passed as `images: [url]` — a URL, so the stored file is
handed over signed rather than uploaded twice.

**Only 8 of the 84 can output a transparent background.** Checked by reading all 84 schemas
for a `background` enum containing `transparent`. That is not a preference for a garment
print: art with a baked background prints as a rectangle, and the other 75 would need the
background cutting afterwards. The default is `openai/gpt-image-2.6-flare/edit` — $0.008, one
of the 8, and the same family already used for text-to-image, so a redraw looks like it came
from the same shop.

Attaching a reference swaps the entire model list, because the two kinds are not
interchangeable: an edit model rejects a request with no image and a text-to-image model
ignores one. The selected model moves with the mode rather than being left pointing at
something that cannot read the reference.

**A style name is a weak instruction.** "Preppy" could mean anything to an image model, so
each style in the dropdown carries a concrete description of its visual language — palette,
line quality, motifs, era — and that is what reaches the model. The dropdown name is only
what the person reads.

Three things the brief has to say, learned from what this shop prints:

- **Redraw, not edit.** Handed a picture and a style name, an edit model tends to tint the
  original. The wording asks for a new illustration that borrows subject and composition.
- **Transparent background, no scene**, for the same reason the model has to support it.
- **Lettering is opt-in.** The reference may carry a word that belongs to the design, or one
  that should be dropped so new copy can take its place.

Verified on a real reference: a vintage-illustration Santa booping a reindeer's nose, redrawn
preppy, came back with the same subject, pose, composition and the word "Boop" — in hot pink,
green gingham, smiley faces and bows. A reinterpretation rather than a filtered copy, with
the alpha channel intact, for one cent.

One gap worth knowing: these return 1024x1024 by default, below the 4494px print width, so
the print-ready step upscales. Setting `size` to 2048x2048 in the model's own settings avoids
that.

References are stored under `references/` rather than `designs/`, so nothing that walks the
designs folder mistakes an input for a design. They are recorded only in the job payload, not
in a path column, so `findOrphans` reads job payloads too — without that the sweep would
delete a reference a retry still needed.
