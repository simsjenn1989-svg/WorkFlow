# Using WorkFlow

A walk-through of the app as it actually behaves, screen by screen, in the order you'd use
them. Every number here was read off the running app, not estimated.

The short version:

```
Generate → pick the keeper → Renders → Pins / Video → Printify draft → write listing → you publish
```

Nothing in WorkFlow ever publishes anything. The last step is always you, in Printify.

---

## 0. Signing in

One password, no accounts. Everything except the login page is behind it, so a new screen
added later is protected automatically. The session is a cookie — sign out from the top
right when you're on a shared machine.

---

## 1. The Board — where everything lives

The Board is the home screen, and it's the honest answer to "what state is my shop in".
Each column is a **stage**, and a design sits in exactly one of them. The column header
tells you what it's waiting for:

| Column | What it means | What to do |
|---|---|---|
| **Idea** | Written down, not made yet | **Generate this** on the card |
| **Generated** | Several images came back | Pick the keeper |
| **Approved** | A keeper is chosen | Render mockups, or push a draft |
| **Print ready** | Sized for the blueprint | (optional — the push does this for you) |
| **Mockups done** | Renders exist | Make pins and video |
| **Assets done** | Pins/video done | Push to Printify |
| **Pushed** | Draft is in your shop | Write the listing |
| **Polished** | Listing copy applied | **Your turn** — review and publish |
| **Published** | Live | Done |

**Rejected** and **Archived** are two more stages, for things you want out of the way
without deleting. They have no columns until something is in them — put a design there with
the **Jump to** dropdown (below), and the column appears.

### Moving a card

There is **no drag-and-drop**. A stage change is a deliberate act, so it's buttons, inside
the opened design:

- **← Back** — one stage left.
- **Move to [next stage] →** — one stage right.
- **Jump to** — a dropdown of every stage, including Rejected and Archived.

Most of the pipeline moves cards for you — picking a keeper, finishing a render, pushing a
draft — so these are for corrections and for the last step, which is yours.

At the top: **Search** by title, filter by **Collection** or **Tag**, then **Apply**.
**+ Add designs** uploads artwork you made elsewhere. It starts at **Approved**, because
the art already exists — it skips Generated entirely.

**+ New idea** writes down something you intend to make, before it exists. Title, the idea
itself in a sentence or two, optional collection and tags. It lands in **Idea** with no
image, and nothing is charged.

The card then carries a **Generate this** button. That opens the Generate screen with your
own words already in the prompt and **Add to** pointing at that card, so the images land on
the idea you wrote rather than creating a second design. The card moves to **Generated**
when they arrive, and back to **Idea** by itself if the generation fails.

Three ways in, then, and they start in different places:

| | Starts at |
|---|---|
| **+ New idea** | Idea |
| **Generate** | Generated, or Approved when you asked for one image |
| **+ Add designs** (upload) | Approved |

Clicking any card opens that design — see step 3.

---

## 2. Generate — making a design

**Generate** in the nav. Your monthly spend is shown at the top ("$1.69 of $20.00 used this
month"). The cap is real: a generation that would cross $20 is refused rather than charged.

### Start from a reference (optional)

**+ Upload an image to redraw**, then pick a style. This redraws the same subject and layout
in that style rather than recolouring the original, and the model list switches to ones that
can read an image. There's an **anything to add** box for a tweak like *"swap the reindeer
for a cat"*.

### The prompt

Either type one or pick a saved one from the dropdown. Saved prompts can have `{{slots}}` —
pick one and you get a box per slot to fill in.

Under the box you'll see **"Sent to the model"**. That's the real prompt, after the app
rewrites it. It will differ from what you typed, deliberately:

> **Don't ask for a transparent background.** No model in the list can make one. Asked for
> transparency, they paint the grey-and-white checkerboard *as artwork* — this happened for
> real and cost a generation. The app strips that phrasing and adds a magenta screen
> instead, which is cut out automatically once the image lands.

Do ask for **light colours**. You print on black; dark art disappears.

### Model and count

Every model is listed with its price per image — from **$0.003** (GPT Image 2.5 Flare) to
**$0.212** (Kling Image 4.0 Long-Image). Search the list by name. Resolution defaults to the
largest the model offers, because print needs the pixels.

Set **how many** images, optionally a **collection** and **tags**, then generate. The
**Estimate** shown is the catalogue price; the real charge is recorded against your month
once the images arrive, and it's often higher — size and quality multiply it.

### While it runs

Generation takes about 20 seconds. The card appears in **Generated** immediately and fills
in when the images land. Closing the laptop is fine — the job is recorded and collected
later.

If a card is still saying "generating" after a while, it will time out on its own at 10
minutes and offer **Retry**. Nothing is charged for a generation that produced no images.

---

## 3. Opening a design — picking the keeper

This one isn't in the nav. **Click a card on the Board** and it opens; that's the only way
in, and it's where most of the per-design work happens. You get:

- **The image**, on a checkerboard so you can see the transparency, with **Download PNG**
  underneath.
- **Variants** — every image from that generation. **Asking for one image needs no
  decision, so it becomes the artwork by itself**, on the placement you chose on the Generate
  screen, and the design lands in **Approved**. Ask for two or more and they wait: hit
  **Use this one** on the keeper, which moves the design to Approved and spends about six
  seconds sizing it to the print area (see below). Each tile also has its own small
  **download** link, which is how you get an option you *didn't* pick out of the app.
- **Artwork** panel (right) — what is actually on each placement. This is not where you
  tell the app where the design goes: a variant already carries the placement you chose on
  the Generate screen, and **Use this one** is what puts it there.

  **+ Add placement** is for a *second* print — a different back, the same art on the
  pocket. Choose the placement (**front, back, pocket, left sleeve, right sleeve**), then
  where the image comes from:
  - **An image this design has** — any artwork or variant it already holds, including ones
    you didn't pick. The same file is used on both placements, not a copy; each is sized
    and positioned on its own at push time.
  - **A file from my computer** — art you made elsewhere.

  It opens on the first placement the design doesn't have yet, and an option already in use
  says so rather than replacing it silently. **nudge position** moves the art on the garment
  if the automatic placement isn't right.

  A placement only reaches Printify if the product has a print area of the same name. Your
  Comfort Colors 1717 has **front** and **back** only — pocket and sleeve art will render on
  mockups and pins, but the push skips it.
- **Stage buttons** — ← Back, Move to [next], and Jump to.
- **Details** — title, collection, tags, notes.
- **Provenance** — the model, seed and exact prompt that made it.
- **History** — every stage change with timestamps.
- **Delete design**, which warns you first how many renders, pins and clips go with it.
  Drafts already in Printify are *not* deleted — you remove those in Printify.

---

### What "Approved" does to the file

Picking the keeper doesn't just mark a decision — it builds the file everything downstream
uses. The art is trimmed to its visible pixels, enlarged, and placed on a transparent canvas
that **is** the print area: 4494×5097, every design, every time.

This is why it matters: before, each design kept whatever size and padding the model gave
it, so a mockup area filled with the whole file printed the art small and floating. Now the
canvas fills the area and the art sits in the same place on every design, so an area marked
once works for all of them — and Printify gets the same canvas, so the mockup and the print
are the same arithmetic instead of two that happen to agree.

Inside the canvas the art **fills the print area** — the full 14.98in width unless its own
shape makes height the limit — with its top **3.79in below the collar**, as high as this
blueprint's area starts. The print area is already the region that prints cleanly, so there
is no reason to hold art inside it twice.

To make a placement print smaller, set **max width** or **max height** on it in the preset
editor. Leave them blank to fill.

---

## 4. Mockups — your blank garments (one-time setup)

**+ Add mockups** uploads your blank-product photos. Then open one and **mark the print
area**: drag the corners over the printable panel, rotate if the shirt is at an angle, label
it (`front`, `back`). Save.

**A mockup's area and Printify's are not the same thing**, and you choose which one you're
marking:

- **Mark the real print panel** — roughly shoulder to shoulder, starting about 3.8in below
  the collar — and the render is *true to print*: what the customer gets. **Fit to print
  area** reshapes an area to the panel's exact proportions.
- **Mark where you want the graphic to appear in that photo** and the render is a better
  photo. On a model cropped at the waist, the real panel runs off the bottom of the frame,
  so a tighter area reads better.

Either way the graphic is scaled to fill the area it's given, keeping its own proportions —
so to make a design bigger in a particular shot, make that mockup's area bigger. Corners
stay free: pushing one into a fold is what makes the print sit in the fabric rather than on
it.

One caution on the second option: a graphic drawn much bigger than it will really print
oversells the product. Keep it close.

You do this **once per photo**. Every design from then on reuses it.

**Auto-place** does the marking for you. It finds the shirt in the photo — a black garment
is the dark, desaturated region, which skin, hair, denim and a lit room are not — measures
its shoulder width and where the neckline ends, and puts the print at **60% of the shoulder
width**, centred on the garment, just below the collar. On a two-up photo it detects each
half separately.

Why measured rather than eyeballed: a box set to a fixed fraction of the *photo* is a
sensible print on a close crop and runs off the sleeves on a wide shot. Across these
mockups the shoulder width ranges from 39% to 66% of the frame, so no single fraction of
the image works for all of them.

It's on each mockup (next to Fit to print area) and as **Auto-place all** on the Mockups
list, which does every photo in turn and says which one it's on. It saves as it goes and
there's no undo, so it asks twice.

---

## 5. Renders — design × mockup

Tick **designs** on the left, **mockups** on the right, hit **Render**. The button counts
what you asked for ("Render 12 images — 3 designs × 4 mockups").

Each area takes the artwork whose placement label matches it, and a pair with missing
artwork is **skipped rather than part-rendered** — so a design with no back art won't
produce a broken back mockup.

Rendering is local compositing. **It costs nothing.** Designs with a finished render move to
**Mockups done**.

**Download all** gives you every finished render in one zip, named
`design-title_mockup-name.jpg`. Select some first and it becomes **Download N** for just
those.

**Deleting renders:** click a tile's checkbox (top-left on hover) or **Select all**, then
**Delete**, which asks a second time. The image files go with the rows. Stages are left
alone — a design in Mockups done with no renders is one you're about to re-render, not one
that has moved backwards.

---

## 6. Pins — free, instant

Built from finished renders, drawn in the browser, so it costs nothing and redraws as you
type. Pick a render, write a headline (*"The Tee Everyone Asks About"*), a button label
(*"Shop now"*), your URL, pick a look — and you can **save a look** by name to reuse it.
Export the image.

If the screen says "No finished renders yet", run a batch on **Renders** first.

---

## 7. Video — UGC clips (this one costs money)

A finished render becomes a vertical clip. The price is shown before anything runs.

- Pick the render, pick the **framing** (the 9:16 frame prep).
- Pick a model — **Seedance v1 Pro Fast** is the default.
- **Seconds** is a dropdown of what that model actually accepts, not a free number, because
  some models only take 4/6/8 and reject anything else.
- A **motion prompt** is worth writing. Without one you're relying on the model to invent
  movement, which is where clips come back as nothing useful.
- **Saved shots** keep a setup you liked so you can re-run it on another render.

---

## 8. Printify — making the draft

### Presets (set up once)

A preset is the product: blueprint, print provider, sizes, prices, print areas. **+ New from
Printify** pulls one in from your shop. Yours is **Comfort Colors 1717 — Black**, The
Unfiltered Club, 7 sizes, front only, 4494×5097 px.

Inside **edit**:
- **Sizes and prices** — a price box per size (S through 4XL), plus **set all to $ … apply**
  to put one price on all seven at once.
- **Print areas** — each placement is **printed** or **not printed** (back is off by
  default, and when it's off *no placeholder is sent to Printify at all*). For a printed
  one you set **top below collar**, **max width** and **max height**, in inches.
  These are limits, not coordinates — the actual position is worked out per design from the
  trimmed art.
- **Use this preset by default**, then **Save changes**.

### Pushing

Tick designs, confirm the preset, hit **Make drafts**.

Optionally tick **Use the Atlas upscaler — $0.01 per placement**. It gives crisper edges
than the free resize; worth it for fine lettering, not much else.

What happens automatically on the way out, so you don't have to think about it:
- the canvas built at approval is sent **whole** — dead centre, full width — so Printify
  prints exactly what the mockup showed,
- a design approved before canvases existed is still trimmed and placed **3 inches below
  the collar** on the way out,
- placements with no artwork are **not sent at all**.

Designs move to **Pushed**. **Drafts are never published** — that's the whole design of it.

---

## 9. The listing — Claude writes it in your voice

### Listing styles (set up once)

A style is learned from a real shop. **Learn from this shop** reads one of your existing
shops (MoonBloom, Florumi, Starlit Christmas Co., The Unfiltered Club…) and picks up its
voice: the phrases you always use, what the title ends with, what's always included.

### Writing one

On a draft under **Drafts in Printify**, click **write listing**:
- pick a model (**DeepSeek V4.1 Flash** is fast and reliable here),
- add anything specific in **Anything to add**,
- **Write the listing**.

You get a title, description and tags in your shop's voice. **You edit it before it goes on
the draft**, then apply it. The design moves to **Polished**.

**open in Printify →** takes you to the draft itself.

---

## 10. Publishing

You do this. In Printify: check the mockups, check the copy, publish to Etsy or TikTok Shop.

Then come back, open the card, and hit **Move to Published →** so the Board matches reality.
Nothing else marks a design published — the app has no way to know you did it.

---

## Collections and Prompts

- **Collections** — a theme you run as a batch, so all its designs go through the same
  mockups and pins together. Deleting a collection keeps its designs; they just become
  uncollected.
- **Prompts** — saved prompt templates with `{{slots}}`. Edit them here and the Generate
  screen picks the change up immediately.

---

## Money

- Everything is charged against a **$20/month** ceiling. The Generate screen shows what's
  left; a job that would cross the line is refused, not charged.
- **Free:** renders, pins, trimming, placement, background cutout, downloads.
- **Paid:** image generation (from $0.003), video, the optional $0.01 upscaler, and listing
  writing (fractions of a cent).
- The ledger records what Atlas **actually charged**, not the estimate — the two differ by a
  lot at high resolution.

---

## When something goes wrong

| Symptom | What it is |
|---|---|
| Card stuck on "generating" | Times out at 10 minutes, then offers **Retry**. Nothing was charged. |
| Speckled halo around the art | A prompt asked for transparency. Fixed now, but check the "Sent to the model" preview. |
| Design looks washed out on black | Ask for light colours in the prompt. |
| A render didn't appear | Its design had no artwork for that area, so the pair was skipped. |
| Draft rejected by Printify | Usually a preset mismatch — re-pull the preset with **+ New from Printify**. |
