import { SIZES, type PinContent, type PinStyle } from './style';

/**
 * Pin compositing, ported from `legacy/pin-tool/index.html`.
 *
 * The measuring and drawing maths is carried over unchanged — the auto-shrink loop, the
 * gap ratios, the CTA pill proportions, the per-layout geometry. Those numbers came from
 * using the tool, and re-deriving them would mean re-learning them.
 *
 * It runs on a canvas rather than on the server. Laying out wrapped, letter-spaced,
 * auto-shrinking text is something a canvas does natively and `sharp` does not, and keeping
 * it in the browser means a pin redraws instantly and costs nothing to produce.
 */

type Ctx = CanvasRenderingContext2D;

type TextPart = {
  type: 'text';
  lines: string[];
  font: string;
  lh: number;
  color: string;
  gap: number;
  track: number;
};
type PillPart = {
  type: 'pill';
  text: string;
  font: string;
  h: number;
  w: number;
  gap: number;
  track: number;
};
type Part = TextPart | PillPart;
type Block = { parts: Part[]; h: number; widest: number };

type Rect = { x: number; y: number; w: number; h: number };

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const fontStr = (weight: string | number, size: number, family: string) =>
  `${weight} ${Math.max(1, Math.round(size))}px ${family}`;

function setTracking(ctx: Ctx, px: number) {
  if ('letterSpacing' in ctx) {
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
  }
}

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width <= maxW) line = next;
      else {
        out.push(line);
        line = words[i]!;
      }
    }
    out.push(line);
  }
  return out;
}

function measureBlock(
  ctx: Ctx,
  style: PinStyle,
  content: PinContent,
  maxW: number,
  scale: number,
): Block {
  const parts: Part[] = [];
  let h = 0;
  let widest = 0;
  const lhMul = style.lineHeight / 100;
  const tSize = style.titleSize * scale;
  const sSize = style.subSize * scale;

  const title = (style.upper ? content.title.toUpperCase() : content.title).trim();
  if (title) {
    const font = fontStr(style.titleWeight, tSize, style.titleFont);
    ctx.font = font;
    setTracking(ctx, style.tracking * scale);
    const lines = wrap(ctx, title, maxW);
    for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
    setTracking(ctx, 0);
    const lh = tSize * lhMul;
    parts.push({ type: 'text', lines, font, lh, color: style.titleColor, gap: 0, track: style.tracking * scale });
    h += lines.length * lh;
  }

  const sub = content.subtitle.trim();
  if (sub) {
    const font = fontStr(400, sSize, style.bodyFont);
    ctx.font = font;
    const lines = wrap(ctx, sub, maxW);
    for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
    const lh = sSize * Math.max(1.15, lhMul);
    const gap = parts.length ? sSize * 0.55 : 0;
    parts.push({ type: 'text', lines, font, lh, color: style.subColor, gap, track: 0 });
    h += gap + lines.length * lh;
  }

  if (style.cta.trim()) {
    const cSize = style.subSize * 0.95 * scale;
    const font = fontStr(700, cSize, style.bodyFont);
    ctx.font = font;
    setTracking(ctx, cSize * 0.06);
    const tw = ctx.measureText(style.cta.trim().toUpperCase()).width;
    setTracking(ctx, 0);
    const ph = cSize * 2.3;
    const pw = tw + cSize * 2.4;
    widest = Math.max(widest, pw);
    const gap = parts.length ? cSize * 1.0 : 0;
    parts.push({ type: 'pill', text: style.cta.trim().toUpperCase(), font, h: ph, w: pw, gap, track: cSize * 0.06 });
    h += gap + ph;
  }

  if (style.footer.trim()) {
    const fSize = style.subSize * 0.7 * scale;
    const font = fontStr(600, fSize, style.bodyFont);
    ctx.font = font;
    setTracking(ctx, fSize * 0.08);
    const text = style.footer.trim();
    widest = Math.max(widest, ctx.measureText(text).width);
    setTracking(ctx, 0);
    const gap = parts.length ? fSize * 1.1 : 0;
    parts.push({ type: 'text', lines: [text], font, lh: fSize * 1.3, color: style.footerColor, gap, track: fSize * 0.08 });
    h += gap + fSize * 1.3;
  }

  return { parts, h, widest };
}

/** Shrink until the block fits both the width and the height it was given. */
function fitBlock(ctx: Ctx, style: PinStyle, content: PinContent, maxW: number, maxH: number): Block {
  let scale = 1;
  let block = measureBlock(ctx, style, content, maxW, scale);
  for (let i = 0; i < 60; i++) {
    block = measureBlock(ctx, style, content, maxW, scale);
    if ((block.h <= maxH && block.widest <= maxW + 0.5) || scale < 0.2) break;
    scale *= 0.95;
  }
  return block;
}

function drawBlock(ctx: Ctx, style: PinStyle, b: Block, x: number, yStart: number, w: number, shadow: boolean) {
  let y = yStart;
  for (const p of b.parts) {
    y += p.gap;
    if (shadow && p.type === 'text') {
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 3;
    }

    if (p.type === 'text') {
      ctx.font = p.font;
      ctx.fillStyle = p.color;
      ctx.textAlign = style.align;
      setTracking(ctx, p.track);
      const tx = style.align === 'left' ? x : style.align === 'right' ? x + w : x + w / 2;
      for (const line of p.lines) {
        ctx.fillText(line, tx, y + p.lh / 2);
        y += p.lh;
      }
      setTracking(ctx, 0);
    } else {
      const px = style.align === 'left' ? x : style.align === 'right' ? x + w - p.w : x + (w - p.w) / 2;
      ctx.fillStyle = style.ctaBg;
      roundedRect(ctx, px, y, p.w, p.h, p.h / 2);
      ctx.fill();
      ctx.font = p.font;
      ctx.fillStyle = style.ctaColor;
      ctx.textAlign = 'center';
      setTracking(ctx, p.track);
      ctx.fillText(p.text, px + p.w / 2 + p.track / 2, y + p.h / 2);
      setTracking(ctx, 0);
      y += p.h;
    }

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
}

function drawCover(ctx: Ctx, image: CanvasImageSource & { width: number; height: number }, content: PinContent, r: Rect) {
  const s = Math.max(r.w / image.width, r.h / image.height) * content.zoom;
  const dw = image.width * s;
  const dh = image.height * s;
  const dx = r.x + (r.w - dw) / 2 + content.offsetX;
  const dy = r.y + (r.h - dh) / 2 + content.offsetY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, dx, dy, dw, dh);
  ctx.restore();
}

function drawPlaceholder(ctx: Ctx, r: Rect) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  g.addColorStop(0, '#e9dfe6');
  g.addColorStop(1, '#d9e3dc');
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(80,60,75,.45)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(r.w * 0.045)}px -apple-system, Segoe UI, sans-serif`;
  ctx.fillText('Pick a render to start', r.x + r.w / 2, r.y + r.h * 0.35);
  ctx.restore();
}

export type DrawInput = {
  canvas: HTMLCanvasElement;
  style: PinStyle;
  content: PinContent;
  image: (CanvasImageSource & { width: number; height: number }) | null;
};

/** The image region for the current style, so dragging can be mapped to the right rectangle. */
export function imageRegionOf(style: PinStyle): Rect {
  const [W, H] = SIZES[style.size];
  if (style.layout === 'split') {
    const ih = Math.round((H * style.split) / 100);
    return style.position === 'top' ? { x: 0, y: H - ih, w: W, h: ih } : { x: 0, y: 0, w: W, h: ih };
  }
  if (style.layout === 'framed') {
    const f = Math.round(W * 0.05);
    const ih = Math.round((H * style.split) / 100);
    return style.position === 'top'
      ? { x: f, y: H - ih, w: W - 2 * f, h: ih - f }
      : { x: f, y: f, w: W - 2 * f, h: ih - f };
  }
  return { x: 0, y: 0, w: W, h: H };
}

export function drawPin({ canvas, style, content, image }: DrawInput): void {
  const [W, H] = SIZES[style.size];
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const M = Math.round(W * 0.07);
  const pad = Math.round(W * 0.06);
  const pos = style.position;
  ctx.textBaseline = 'middle';

  ctx.fillStyle = style.layout === 'split' || style.layout === 'framed' ? style.boxColor : style.bgColor;
  ctx.fillRect(0, 0, W, H);

  let r: Rect = { x: 0, y: 0, w: W, h: H };
  let textR: Rect | null = null;

  if (style.layout === 'split') {
    const ih = Math.round((H * style.split) / 100);
    if (pos === 'top') {
      r = { x: 0, y: H - ih, w: W, h: ih };
      textR = { x: 0, y: 0, w: W, h: H - ih };
    } else {
      r = { x: 0, y: 0, w: W, h: ih };
      textR = { x: 0, y: ih, w: W, h: H - ih };
    }
  } else if (style.layout === 'framed') {
    const f = Math.round(W * 0.05);
    const ih = Math.round((H * style.split) / 100);
    if (pos === 'top') {
      r = { x: f, y: H - ih, w: W - 2 * f, h: ih - f };
      textR = { x: 0, y: 0, w: W, h: H - ih };
    } else {
      r = { x: f, y: f, w: W - 2 * f, h: ih - f };
      textR = { x: 0, y: ih, w: W, h: H - ih };
    }
    ctx.fillStyle = style.bgColor;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else {
    ctx.fillStyle = style.bgColor;
    ctx.fillRect(0, 0, W, H);
  }

  if (image) drawCover(ctx, image, content, r);
  else drawPlaceholder(ctx, r);

  if (style.layout === 'band') {
    const maxW = W - 2 * pad;
    const b = fitBlock(ctx, style, content, maxW, H * 0.42);
    const bh = b.h + pad * 1.6;
    const by = pos === 'top' ? 0 : pos === 'bottom' ? H - bh : (H - bh) / 2;
    ctx.fillStyle = hexToRgba(style.boxColor, style.boxOpacity / 100);
    ctx.fillRect(0, by, W, bh);
    drawBlock(ctx, style, b, pad, by + (bh - b.h) / 2, maxW, style.shadow);
  } else if (style.layout === 'box') {
    const boxW = W - 2 * M;
    const inner = boxW - 2 * pad;
    const b = fitBlock(ctx, style, content, inner, H * 0.5);
    const bh = b.h + 2 * pad;
    const by = pos === 'top' ? M : pos === 'bottom' ? H - M - bh : (H - bh) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.12)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = hexToRgba(style.boxColor, style.boxOpacity / 100);
    roundedRect(ctx, M, by, boxW, bh, 22);
    ctx.fill();
    ctx.restore();
    drawBlock(ctx, style, b, M + pad, by + pad, inner, style.shadow);
  } else if (style.layout === 'overlay') {
    const a = style.fade / 100;
    if (pos === 'center') {
      ctx.fillStyle = `rgba(0,0,0,${a * 0.75})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      const g =
        pos === 'top'
          ? ctx.createLinearGradient(0, 0, 0, H * 0.7)
          : ctx.createLinearGradient(0, H, 0, H * 0.3);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const maxW = W - 2 * M;
    const b = fitBlock(ctx, style, content, maxW, H * 0.5);
    const y = pos === 'top' ? M * 1.2 : pos === 'bottom' ? H - M * 1.2 - b.h : (H - b.h) / 2;
    // Light text over the dark fade, whatever the theme colours say.
    b.parts.forEach((p, i) => {
      if (p.type === 'text') p.color = i === 0 ? '#ffffff' : 'rgba(255,255,255,.88)';
    });
    drawBlock(ctx, style, b, M, y, maxW, true);
  } else if (textR) {
    const maxW = W - 2 * pad;
    const b = fitBlock(ctx, style, content, maxW, textR.h - pad * 1.4);
    drawBlock(ctx, style, b, pad, textR.y + (textR.h - b.h) / 2, maxW, style.shadow);
  }

  if (style.border) {
    const i = Math.round(W * 0.025);
    ctx.strokeStyle = hexToRgba(style.layout === 'overlay' ? '#ffffff' : style.titleColor, 0.55);
    ctx.lineWidth = 3;
    ctx.strokeRect(i, i, W - 2 * i, H - 2 * i);
  }
}
