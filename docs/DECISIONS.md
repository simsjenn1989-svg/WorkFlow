# Decisions and open questions

## Locked in

| Decision | Choice | Date |
|----------|--------|------|
| Scope | Single user, just the owner | 2026-11-19 |
| First product | Comfort Colors 1717, Printify Choice provider, **black only** | 2026-11-19 |
| Sales channels | TikTok Shop + Etsy | 2026-11-19 |
| Design generation | Atlas Cloud, inside the app | 2026-11-19 |
| Mockup sources | JPG/PNG photos only. PSD dropped — not enough exist in the wanted style | 2026-11-19 |
| Pins | Composed locally, zero API credits | 2026-11-19 |
| UGC video | Atlas Cloud image-to-video, from mockup renders | 2026-11-19 |
| Listing polish | Claude via the Playground AI connector, not rebuilt in-app | 2026-11-19 |
| Publishing | Always manual. The app only ever creates drafts | 2026-11-19 |
| Stack | Next.js + Supabase + Vercel | 2026-11-19 |

## Why listing polish is not in the app

The Playground AI connector already exposes `printify_*`, `etsy_*`, and `rankhero_*` tools.
Rebuilding that as app screens would mean reimplementing keyword research and listing
editing to end up with something worse, and the step genuinely benefits from judgment rather
than a form. The app instead keeps a clean queue of drafts that are ready for it.

## Why print areas are fetched, not hardcoded

Printify's catalog API returns exact placeholder pixel dimensions per
blueprint/print-provider pair. Those values change, vary by provider, and differ between
placements. A guessed constant is how a design ends up cropped at the factory, so the app
fetches and caches per preset instead.

## Resolved

1. **The Pinterest HTML app** — received and preserved at `legacy/pin-tool/index.html`.
   Assessed in [`PIN_TOOL.md`](PIN_TOOL.md). It is more capable than expected: 5 layouts,
   6 themes, AI copy, batch export, CSV of titles and descriptions. Exports files only; does
   not post. On-image text is rasterized, Pinterest title/description stay live.

2. **Colorways** — black only, for now. This simplifies the mockup library (one garment
   color) and sharpens the render engine's job: DTG white ink on black is the hardest case to
   fake convincingly, so the ink simulation in SPEC §2 matters more than it would on white.
   It also means the print-ready checker flags art that is *too dark*, not too light.

3. **PSD dropped entirely** (revised 2026-11-19). There are not enough PSD mockups in the
   style wanted, so the pipeline takes ordinary JPG and PNG photos instead. This removes the
   Phase 3 blocker — no files to wait for — but it also removes the free ride: the print
   area must be marked by hand and the shading derived from the photo, with no smart-object
   transform and no ready-made shading layers to borrow. The hand-marking editor and the
   extraction are now the only path, so the quality bar for both goes up.

## Open questions

1. **Printify shop ID** — needed to push drafts. Retrievable from the API once the token is
   set, so not blocking.

2. **Which mockup photos** — a handful of blank black 1717 shots: a flat lay, a hanging
   shot, a worn front, and one lifestyle scene is plenty to prove the engine. Nothing
   blocks building the editor before they arrive.

3. **Design brightness constraint** — on black only, every design needs enough contrast to
   read. Worth deciding whether the Atlas prompt library should bake "light colors on dark
   background" into its defaults, or leave it per-prompt.

## Risks

| Risk | Mitigation |
|------|-----------|
| Everything now rides on shading extraction from flat photos, with no PSD layers to fall back on | The reason the Phase 3 quality check matters more than it did. If extraction loses the comparison, it gets fixed before anything is built on top |
| Renders look pasted-on, not printed | Phase 3 ends with a blind side-by-side against your best existing mockups. If it loses, the render pipeline gets fixed before anything else is built on it |
| White ink on black looks fake | The hardest case, and the only one that matters since you sell black. Handled explicitly in SPEC §2 and judged in the Phase 3 comparison |
| Atlas spend runs away | Quote before every paid call, monthly ceiling, per-design cost ledger |
| Printify replaces our mockups with its own on publish | Known. Handled in the Claude polish step via `printify_send_mockups_to_etsy` |
| Printify print-area sizes drift | Fetched from the API and cached per preset, never hardcoded |
| AI-generated designs raise IP questions on Etsy/TikTok | Out of the app's scope, but worth your own policy check before scaling volume |
