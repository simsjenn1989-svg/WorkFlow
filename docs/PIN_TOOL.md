# The existing Pin Maker — assessment and port plan

Source preserved verbatim at [`legacy/pin-tool/index.html`](../legacy/pin-tool/index.html)
(1085 lines, single file, zero dependencies). It keeps working standalone; nothing here
replaces it until the ported version is demonstrably better.

## What it already does well

| Capability | Detail |
|---|---|
| Pin sizes | 1000×1500 (2:3), 1000×2100 (tall), 1000×1000 (square) |
| Layouts | `band`, `box`, `overlay` (dark fade), `split` (image + color block), `framed` |
| Themes | 6 curated palettes (Clean white, Blush, Sage, Cream & gold, Lavender, Moody dark) |
| Typography | 9 font stacks, custom font upload (.ttf/.otf/.woff/.woff2), weight, tracking, uppercase, line height |
| Layout controls | text position, alignment, image/text split ratio, inset border, box opacity, fade depth |
| Image handling | multi-upload, per-item zoom and pan, cover-fit |
| Variants | "Duplicate Pin" — same image, new text variant |
| AI copy | Ollama (local, free) or Anthropic direct from browser |
| Export | PNG/JPG, single or batch, plus a CSV of titles and descriptions |
| Persistence | style and AI settings in `localStorage` |

### Three things in it that are genuinely hard-won

These get carried over intact rather than rewritten:

1. **`SYSTEM_PROMPT`** — a well-tuned e-commerce copywriter brief with explicit bad/good
   examples that specifically stops the model from narrating the image ("Red and Green
   Lettering on Crisp White Paper") or writing blog-post headlines ("Why Every Gift Is About
   to Look Better") instead of selling a product. This is the most valuable thing in the
   file and is ported **verbatim**.
2. **The starred-headline feedback loop** — "☆ I like this headline" appends to a list that
   is fed back as few-shot style examples on the next generation. The tool learns your voice.
   Carries over, and gets better in WorkFlow because the examples become a persistent
   library instead of a `localStorage` blob.
3. **`salvageJSON`** — recovers a truncated model reply by closing off the JSON at the last
   complete value. Small, unglamorous, and the difference between a usable tool and a
   frustrating one on local models.

Also worth keeping: per-destination prompt rules (`DESTS`), including correct Amazon
affiliate handling (never claim ownership, never mention price or Prime, auto-append the
disclosure line).

## What needs to change

| Issue | Current | In WorkFlow |
|---|---|---|
| **API key exposure** | Anthropic key lives in browser `localStorage` and is sent with `anthropic-dangerous-direct-browser-access` | Moves to a server route. The key never reaches the browser |
| **Redundant vision step** | Sends a downscaled JPEG and asks the model to work out what the product is | WorkFlow already knows the design's prompt, title, tags, collection and product. Feed that as text instead — better copy, lower cost, no image tokens |
| **Hardcoded layouts** | 5 layouts as `if/else` branches in `render()` | Data-driven `pin_templates` records, so layouts are editable and new ones need no code |
| **No cross-design batching** | Works on one upload session at a time | One design × N templates, or a whole collection × one template |
| **Manual image upload** | Every run starts by picking files | Pulls mockup renders straight from the design library |
| **No posting** | Exports files only | Posting stays optional and later; export comes first |

## Answering the questions I had

- **Pin sizes:** 2:3 standard, tall, and square. All valid for Pinterest; 1000×1500 is the
  recommended default and stays so.
- **Is text baked in?** Both, and the split is correct. The on-image headline, subtitle, CTA
  and footer are rasterized into the PNG. The Pinterest *title* and *description* stay as
  live data and export to CSV. WorkFlow keeps exactly this division, with the live fields in
  the `pins` table instead of a CSV column.
- **Does it post?** No. Export only.

## Port plan (Phase 5)

1. Extract `measureBlock` / `fitBlock` / `drawBlock` / `wrap` / `drawCover` — the text
   fitting and compositing maths — into a shared renderer used by both browser preview and
   server export. It is already cleanly separated, so this is a move rather than a rewrite.
2. Convert the 5 layouts and 6 themes into seeded `pin_templates` rows.
3. Replace the client AI call with a server route that takes design context as text.
4. Make starred headlines a first-class `style_examples` table.
5. Add batching and the export-naming pattern from the main spec.
6. Keep the single-file tool in `legacy/` as a working fallback and reference.
