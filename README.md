# WorkFlow

A single-operator pipeline for turning an idea into a published print-on-demand listing.

```
generate design  →  make print-ready  →  render mockups  →  make pins + UGC video
      →  push draft to Printify  →  Claude polishes the listing  →  you publish
```

Built for one user. First product is the **Comfort Colors 1717** tee via Printify Choice,
going to **TikTok Shop** and **Etsy**.

- Design generation: [Atlas Cloud](https://atlascloud.ai) (~180 image models, ~169 video models)
- Mockups: your own blank-product photos / PSDs, prepared once, re-rendered forever
- Pins: composed locally from existing renders — **no API credits**
- UGC video: Atlas Cloud image-to-video from a mockup render
- Listing polish: handed to Claude, which drives Printify + Etsy via the Playground AI connector

See [`docs/SPEC.md`](docs/SPEC.md) for the full design, and
[`docs/DECISIONS.md`](docs/DECISIONS.md) for open questions and locked-in choices.

## Status

Planning. Nothing built yet.

## Principles

1. **Prepare once, reuse forever.** A mockup's print area and shading are marked a single
   time. Every future render reuses that work.
2. **Nothing publishes itself.** The app creates drafts. A human presses publish.
3. **Every credit is quoted before it is spent.** Generation shows an estimate and a running
   total. Nothing paid runs without an explicit confirm.
4. **Everything traces back.** Each render, pin, video, and listing links to the design and
   the prompt that produced it.
5. **Free work stays free.** Pin composition and mockup rendering are local pixel work, not
   AI calls.
