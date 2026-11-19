# WorkFlow — Specification

Single-operator pipeline: idea → design → mockup → pin/video → Printify draft → polished
listing → publish.

---

## 1. The pipeline

Every design carries exactly one **stage**. The whole app is organized around moving designs
rightward through these stages. Nothing skips a stage; a design can sit at one indefinitely.

| # | Stage | What happens | Cost |
|---|-------|--------------|------|
| 1 | `idea` | A prompt is written, maybe saved from a template | free |
| 2 | `generated` | Atlas Cloud returned variants; none chosen yet | paid |
| 3 | `approved` | You picked the keeper | free |
| 4 | `print_ready` | Background removed, upscaled to the blueprint's print size | paid (cheap) |
| 5 | `mockups_done` | Rendered onto your mockup templates | free |
| 6 | `assets_done` | Pins composed; UGC video generated (optional) | pins free / video paid |
| 7 | `pushed` | Draft product created in Printify, unpublished | free |
| 8 | `polished` | Claude has written title/description/tags | free |
| 9 | `published` | You pressed publish. Marked by you, not the app | free |

A design can also be `archived` or `rejected` from any stage.

### Board view

The home screen is a column-per-stage board. Each card shows a thumbnail, the collection, and
how long it has sat there. This is the answer to "what is waiting on me?" — which is the real
organizational problem, more than folders are.

---

## 2. Why the mockups will look real

This is the part that separates a convincing render from a sticker pasted on a photo. The
technique is standard compositing, applied once per mockup template and reused forever.

### Prepared once, per mockup

1. **Upload** the blank-product photo (JPG or PNG).
2. **Mark the print areas.** Drag four corners per area, stored as normalized coordinates
   so they survive any later resizing of the source photo. A photo can carry several:
   one showing the front and the back of the garment side by side takes two, each
   holding its own artwork, which is how a front-and-back product gets a single listing
   image. Each area is measured separately, because the halves of such a photo are lit
   differently and one baseline would be wrong for both.
3. **Extract a shading map.** The app converts the marked region to luminance, high-pass
   filters it to separate slow lighting gradients from fast fabric detail, and stores two
   grayscale maps: `shadow_map` and `highlight_map`. This is what carries the folds.
4. **Optional mask.** Paint out anything that occludes the print (an arm, a hanger, a
   wrinkle shadow you want preserved at full strength).
5. **Record the garment color** so the app knows what the design is sitting on.

Steps 1–5 happen a single time per template. They are never repeated.

### Per render (fast, free, deterministic)

1. Warp the design into the print area using the stored corners/mesh.
2. `multiply` the shadow map over it, `screen` the highlight map — this is what makes the
   design follow the folds instead of floating above them.
3. Apply a subtle fabric-weave texture at low opacity, scaled to the garment's pixel density.
4. Simulate DTG ink on black: a white underbase is never pure white, so the app desaturates
   slightly, lifts the blacks in the art, and lets a little garment color bleed through.
   Getting this wrong is the most obvious tell of a fake black-tee mockup.
5. Soften edges by a pixel or two, and add a faint displacement along the weave so straight
   lines micro-waver the way printed lines actually do.
6. Composite back, apply the mask, and export at the preset's size.

Preview runs in WebGL in the browser (instant, interactive). Final export runs server-side
with `sharp` for full resolution and color accuracy.

### Photos only

Mockups are ordinary JPG or PNG photos. PSDs were considered and dropped: there simply are
not enough in the style wanted, and a pipeline that depends on finding them is a pipeline
that keeps stalling.

The cost of that is real and worth stating plainly. A PSD hands over the print area from its
smart-object transform and brings its own shading layers, both better than anything derived
from a flat image. Without one, **everything rests on marking the area by hand and
extracting the shading from the photo itself**. The editor and the extraction in this section
are no longer a fallback path — they are the only path, and they are what decides whether a
render reads as printed or pasted.

The upside: no hunting for files that may not exist, any photo you like becomes a mockup,
and the work needed is the work that had to be built anyway.

---

## 3. Design generation (Atlas Cloud)

Atlas Cloud is reached by REST with a server-side API key. The app never ships the key to the
browser.

### Models worth wiring up first

| Job | Model | Why |
|-----|-------|-----|
| Main text-to-image | `openai/gpt-image-2.6-flare/text-to-image` | strong in-image text, native transparent background, up to 3840×2160 |
| High-fidelity alt | `microsoft/mai-image-2.6/text-to-image` | photorealistic, good in-image text |
| Cheap/bulk | `bytedance/seedream-v5.0-flash/text-to-image` | seconds per image, transparent output, built for bulk |
| Edit / fix | `openai/gpt-image-2.6-flare/edit` | masked edits, up to 16 refs |
| Variations | `midjourney/v8.2/image-to-image` | four variations per call |
| Style transfer | `midjourney/v8.2/style-transfer` | restyle while keeping composition |
| Background removal | `midjourney/v8.2/remove-background` | fallback when a model can't output transparency |

Transparent-background generation matters: a tee design needs a clean alpha channel, and
getting it from the generating model is better than cutting it out afterward.

### Prompt library

Prompts are first-class records, not throwaway text. Each has a name, the body, optional
`{{slots}}` for filling in (subject, style, palette), the model it is tuned for, and a list of
designs it produced. Good prompts are the actual asset here, so they get versioned.

### Cost control

- The Atlas API quotes before running. The app shows that quote, in dollars, before any batch.
- A monthly ceiling you set. At 80% the app warns; at 100% it refuses paid calls until you
  raise it.
- Every paid call is written to a `cost_ledger` row tagged with the design, so per-design and
  per-month spend are always answerable.

---

## 4. Print-ready conversion

Between "I like this design" and "Printify will accept it":

1. Ensure a real alpha channel; remove the background if the model didn't.
2. Trim transparent padding, then scale to fit the blueprint's print area.
3. Upscale to the required pixel size at 300 DPI.
4. Flag problems before they reach Printify: resolution too low to upscale cleanly, art too
   dark to read on a black garment, detail that will vanish at print scale, or an aspect
   ratio that will letterbox badly in the print area.

**The print area size is fetched from Printify, never hardcoded.** Printify's catalog API
returns each blueprint/provider's placeholders with exact pixel dimensions. Hardcoding a
guessed number is how garments come out cropped.

---

## 5. Pinterest pins — zero credits

Pins are composed from assets that already exist. No model call, no credits.

- A pin template is a layout: canvas size (1000×1500 for the 2:3 standard), image slots, text
  blocks with fonts/colors, and background treatment.
- Slots are filled from existing mockup renders and the design's own art.
- Rendering is canvas/`sharp` compositing — pure local pixel work.
- Batch: one design × N templates, or a whole collection × one template.
- Pin copy (headline, subtitle, CTA, Pinterest title and description) is written by a text
  model from the design's own prompt and tags — cheap text generation, not image generation.

### Integrating the existing Pin Maker

The existing single-file tool is substantial — 1085 lines, zero dependencies, 5 layouts, 6
themes, custom font upload, AI copy generation via Ollama or Anthropic, batch export, and a
CSV of Pinterest titles and descriptions. It is preserved at `legacy/pin-tool/index.html` and
keeps working standalone.

Its on-image text is rasterized into the PNG while the Pinterest title and description stay
live data — the right split, and one WorkFlow keeps.

Three parts carry over intact: the tuned copywriter `SYSTEM_PROMPT`, the starred-headline
loop that learns your voice, and `salvageJSON` for truncated model replies. The main changes
are moving the API key server-side, feeding the model the design's known context instead of
asking it to identify the product from a downscaled image, and turning the hardcoded layouts
into editable template records.

Full assessment and port plan: [`docs/PIN_TOOL.md`](PIN_TOOL.md).

Posting to Pinterest is a later, optional step; composing and downloading pins comes first.

---

## 6. UGC-style video

For TikTok Shop, where video carries the listing.

Source frame is a mockup render, so the shirt in the video is the real design on the real
garment.

| Job | Model | Notes |
|-----|-------|-------|
| Default | `bytedance/seedance-2.5-flash/image-to-video` | 4–30s, 480p/720p, synced audio, ~2× faster and ~34% cheaper than the flagship |
| Higher quality | `bytedance/seedance-2.5/image-to-video` | same shape, flagship quality |
| Consistent presenter | `bytedance/seedance-2.5-flash/reference-to-video` | up to 10 reference images — keeps the same person across clips |
| Cinematic w/ audio | `google/gemini-omni-1.1-flash/image-to-video` | natively sound-enabled |

A **shot library** holds reusable UGC prompts: unboxing, mirror try-on, flat-lay reveal,
close-up fabric pan. Each stores its prompt, model, duration, and aspect ratio (9:16 for
TikTok). Generating is then picking a design plus a shot, not writing a prompt from scratch.

Video is the most expensive thing the app does, so it always quotes and always needs an
explicit confirm — no silent batch spend.

---

## 7. Printify push

The app creates **unpublished drafts** only.

1. Upload the print-ready art (`POST /v1/uploads/images.json`).
2. Create the product against a saved **product preset**.
3. Leave it unpublished.

### Product presets

A preset is the boring-but-critical config you otherwise re-pick every single time:
blueprint, print provider, which variants (colors × sizes) to enable, print-area placement
and scale, and base pricing or markup. Saved once per product type.

First preset: **Comfort Colors 1717, Printify Choice**, with your chosen colorways and size
range.

### A constraint worth knowing now

When Printify publishes to Etsy or TikTok Shop, it attaches **its own** generated mockups —
not yours. Getting your better mockups onto the listing takes a deliberate step. The Playground
AI connector exposes `printify_send_mockups_to_etsy` and `etsy_upload_listing_image`, so the
cleanest route is: app creates the draft → Claude pushes your mockups and rewrites the listing
→ you publish. This is why the handoff in §8 exists rather than the app trying to own
publishing.

---

## 8. Listing polish — handed to Claude

Deliberately **not** rebuilt inside the app. The Playground AI connector already has the
tools, and this step benefits from judgment rather than a form.

The app's job is to make the handoff clean: a **Ready for Polish** queue listing each pushed
draft with its design, prompt, tags, collection, mockups, and Printify product ID.

Claude then, in an ordinary session:

- `printify_list_products` / `printify_get_product` — read the drafts
- `rankhero_keyword_suggestions`, `rankhero_analyze_listing` — real Etsy keyword data
- `printify_update_product` — title, description, tags
- `printify_send_mockups_to_etsy` / `etsy_upload_listing_image` — your mockups, not Printify's
- `etsy_update_listing` — Etsy-specific fields

You review and publish. The app records the result so a design reaches `polished` and then
`published`.

---

## 9. Data model

```
collections        id, name, theme, notes, created_at
prompts            id, name, body, slots[], target_model, notes
designs            id, collection_id, prompt_id, stage, title, tags[],
                   source_model, source_params(jsonb), seed,
                   raw_image_path, print_ready_path, notes, created_at
design_variants    id, design_id, image_path, model, params, chosen(bool), cost_cents

products           id, name, blueprint_id, print_provider_id,
                   variants(jsonb), placement(jsonb), pricing(jsonb)
mockup_templates   id, product_id, name, source_type(photo),
                   source_path, print_area(jsonb: corners|mesh),
                   shadow_map_path, highlight_map_path, mask_path,
                   garment_color, tags[](angle, scene, colorway), active
renders            id, design_id, mockup_template_id, export_preset_id,
                   output_path, status, created_at

pin_templates      id, name, canvas(jsonb), slots(jsonb), text_blocks(jsonb)
pins               id, design_id, pin_template_id, source_render_id,
                   title, description, link, output_path

shot_templates     id, name, prompt, model, duration_s, aspect_ratio
videos             id, design_id, source_render_id, shot_template_id,
                   model, output_path, duration_s, cost_cents, status

printify_products  id, design_id, product_id, shop_id, blueprint_id,
                   status, pushed_at, published_at
listings           id, printify_product_id, platform(etsy|tiktok),
                   title, description, tags[], polished_at

export_presets     id, name, width, height, format, quality, naming_pattern
jobs               id, kind, payload(jsonb), status, cost_cents,
                   error, created_at, finished_at
cost_ledger        id, design_id, job_id, provider, model,
                   amount_cents, created_at
```

Everything downstream points back at `designs`, so any output can be traced to its prompt and
regenerated.

### Naming

Exports are auto-named from a pattern, default:

```
{collection}_{design}_{product}_{angle}_{index}.{ext}
```

No more `final_v3_ACTUAL_final.png`.

---

## 10. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| App | Next.js (App Router) + TypeScript | one deployable, server routes keep API keys server-side |
| Hosting | Vercel | already connected to your account |
| DB + storage | Supabase (Postgres + Storage) | already connected; Postgres suits the relational pipeline |
| Preview render | WebGL (`regl` or raw canvas2d) | interactive, no round-trip |
| Export render | `sharp` + custom warp | full resolution, correct color |
| Queue | Postgres `jobs` table, polled | one user; a real queue is unnecessary complexity |
| Auth | Supabase Auth, single account | just you |

### Secrets

Server-side environment variables only, never in the browser, never committed:

```
ATLAS_CLOUD_API_KEY
PRINTIFY_API_TOKEN
PRINTIFY_SHOP_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The repo ships `.env.example` with empty placeholders. Real values are set in Vercel's
dashboard and a local `.env.local` that is gitignored. Don't paste real keys into chat.

---

## 11. Build order

Each phase ends with something usable, so the app is never a half-built thing you can't touch.

**Phase 1 — skeleton + design library.** Next.js app, Supabase schema, collections, designs,
the stage board, manual image upload. Usable as an organizer immediately, before any AI is
wired in.

**Phase 2 — Atlas generation.** Prompt library, model picker, batch generate, variant
picker, cost quoting and ledger. Transparent-background output.

**Phase 3 — mockups.** Photo upload, the print-area editor (corners + mesh), automatic
shading extraction, WebGL preview, server export, DTG-on-black ink simulation. *This is the phase that decides whether the whole
app is worth using, so it gets a real side-by-side quality check against your best existing
mockups before moving on.*

**Phase 4 — Printify push.** Product presets, Comfort Colors 1717 preset, print-ready
conversion, draft creation, the Ready-for-Polish queue.

**Phase 5 — pins.** Port the existing HTML tool, template records, batch composition, export
presets.

**Phase 6 — UGC video.** Shot library, image-to-video, cost confirmation, 9:16 output.

**Phase 7 — polish.** Batch mode across designs × mockups × colorways, search, duplicate
detection, more product types.

---

## 12. Out of scope

- Multi-user accounts, teams, permissions
- Publishing to any platform automatically — drafts only, always
- A design editor (layers, typography). Designs come from Atlas, Kittl, and Playground AI;
  this app organizes and applies them
- Order management, fulfillment, customer service
- Generating designs or pins that consume credits without an explicit confirm
