# Decisions and open questions

## Locked in

| Decision | Choice | Date |
|----------|--------|------|
| Scope | Single user, just the owner | 2026-11-19 |
| First product | Comfort Colors 1717, Printify Choice provider | 2026-11-19 |
| Sales channels | TikTok Shop + Etsy | 2026-11-19 |
| Design generation | Atlas Cloud, inside the app | 2026-11-19 |
| Mockup sources | Both JPG/PNG and PSD; photo path built first | 2026-11-19 |
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

## Open questions

1. **The existing Pinterest HTML app.** Needed before Phase 5 can be planned properly. Paste
   the file into chat, or commit it to this repo under `legacy/pin-tool/` and I will work
   from there. What matters: the pin sizes it outputs, whether text is baked into the image or
   stays live, and whether it posts to Pinterest or only exports files.

2. **Printify shop ID.** The app needs the shop ID to push drafts. Retrievable from the API
   once the token is set, so this is not blocking — just noting it is required.

3. **Colorways for the 1717 preset.** Which Comfort Colors shades do you actually sell? It
   determines how many mockup templates are worth preparing, since each garment color
   ideally gets its own blank photo. A sensible starting set: one light (Ivory or White),
   one mid (Sandstone or Blue Jean), one dark (Pepper or Black).

4. **How many mockup templates to start with.** Three to five for the 1717 is enough to prove
   the render engine: a flat lay, a hanging shot, a worn front, and one lifestyle scene. More
   can be added anytime without touching code.

5. **Whether the existing PSDs cover the 1717.** If they do, PSD import moves earlier in the
   build order, because it skips the manual print-area marking entirely.

## Risks

| Risk | Mitigation |
|------|-----------|
| Renders look pasted-on, not printed | Phase 3 ends with a blind side-by-side against the best existing mockups. If it loses, the render pipeline gets fixed before anything else is built on it |
| Atlas spend runs away | Quote before every paid call, monthly ceiling, per-design cost ledger |
| Printify replaces our mockups with its own on publish | Known. Handled in the Claude polish step via `printify_send_mockups_to_etsy` |
| Printify print-area sizes drift | Fetched from the API and cached per preset, never hardcoded |
| AI-generated designs raise IP questions on Etsy/TikTok | Out of the app's scope, but worth your own policy check before scaling volume |
