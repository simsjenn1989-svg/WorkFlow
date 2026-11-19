/**
 * Pin style, ported from the original Pin Maker (`legacy/pin-tool/index.html`).
 *
 * The sizes, layouts, fonts, defaults and themes are carried over as they were: they are
 * the result of actually using the tool, and changing them would quietly change every pin
 * that already works.
 */

export const SIZES = {
  '1000x1500': [1000, 1500],
  '1000x2100': [1000, 2100],
  '1000x1000': [1000, 1000],
} as const;

export type SizeKey = keyof typeof SIZES;

export const SIZE_LABELS: Record<SizeKey, string> = {
  '1000x1500': 'Standard 2:3 — recommended',
  '1000x2100': 'Tall 1:2.1',
  '1000x1000': 'Square',
};

export const LAYOUTS = {
  band: 'Text band across image',
  box: 'Floating text box',
  overlay: 'Text on image (dark fade)',
  split: 'Split: image + colour block',
  framed: 'Framed photo + text below',
} as const;

export type LayoutKey = keyof typeof LAYOUTS;

/** Font stacks, as named in the original. */
export const FONTS: [label: string, family: string][] = [
  ['Georgia (classic serif)', "Georgia, 'Times New Roman', serif"],
  ['Elegant serif', "'Playfair Display', Didot, 'Bodoni MT', 'Bodoni 72', Georgia, serif"],
  ['Palatino', "'Palatino Linotype', Palatino, 'Book Antiqua', serif"],
  ['Clean sans', "'Helvetica Neue', Helvetica, Arial, sans-serif"],
  ['Modern sans', "'Avenir Next', Avenir, 'Segoe UI', 'Trebuchet MS', sans-serif"],
  ['Geometric', "Futura, 'Century Gothic', 'Trebuchet MS', sans-serif"],
  ['Bold condensed', "Impact, 'Arial Black', Haettenschweiler, sans-serif"],
  ['Script', "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', 'Apple Chancery', cursive"],
  ['Typewriter', "'Courier New', Courier, monospace"],
];

export type PinStyle = {
  size: SizeKey;
  layout: LayoutKey;
  position: 'top' | 'center' | 'bottom';
  align: 'left' | 'center' | 'right';
  split: number;
  border: boolean;
  cta: string;
  footer: string;
  titleFont: string;
  titleWeight: string;
  tracking: number;
  titleSize: number;
  upper: boolean;
  bodyFont: string;
  subSize: number;
  lineHeight: number;
  titleColor: string;
  subColor: string;
  boxColor: string;
  bgColor: string;
  boxOpacity: number;
  fade: number;
  ctaBg: string;
  ctaColor: string;
  footerColor: string;
  shadow: boolean;
  format: 'png' | 'jpeg';
};

export const DEFAULT_STYLE: PinStyle = {
  size: '1000x1500',
  layout: 'band',
  position: 'bottom',
  align: 'center',
  split: 62,
  border: false,
  cta: '',
  footer: '',
  titleFont: FONTS[1]![1],
  titleWeight: '700',
  tracking: 0,
  titleSize: 110,
  upper: false,
  bodyFont: FONTS[4]![1],
  subSize: 40,
  lineHeight: 112,
  titleColor: '#2b2730',
  subColor: '#6b6070',
  boxColor: '#ffffff',
  bgColor: '#f4ece8',
  boxOpacity: 92,
  fade: 60,
  ctaBg: '#c86b8f',
  ctaColor: '#ffffff',
  footerColor: '#6b6070',
  shadow: false,
  format: 'png',
};

export type Theme = { name: string; colours: Partial<PinStyle> };

export const THEMES: Theme[] = [
  { name: 'Clean white', colours: { titleColor: '#222222', subColor: '#666666', boxColor: '#ffffff', bgColor: '#f2f2f2', ctaBg: '#222222', ctaColor: '#ffffff', footerColor: '#777777' } },
  { name: 'Blush', colours: { titleColor: '#5a2e44', subColor: '#8c5a70', boxColor: '#f9e3ea', bgColor: '#fbeff3', ctaBg: '#c86b8f', ctaColor: '#ffffff', footerColor: '#8c5a70' } },
  { name: 'Sage', colours: { titleColor: '#2f3e30', subColor: '#56685a', boxColor: '#e4ebdf', bgColor: '#eef2ea', ctaBg: '#6d8b6f', ctaColor: '#ffffff', footerColor: '#56685a' } },
  { name: 'Cream & gold', colours: { titleColor: '#4a3b28', subColor: '#8a7350', boxColor: '#fbf5e9', bgColor: '#f6eedc', ctaBg: '#b8954e', ctaColor: '#ffffff', footerColor: '#8a7350' } },
  { name: 'Lavender', colours: { titleColor: '#3d3157', subColor: '#6d5f8a', boxColor: '#ece6f7', bgColor: '#f3effa', ctaBg: '#8b74c2', ctaColor: '#ffffff', footerColor: '#6d5f8a' } },
  { name: 'Moody dark', colours: { titleColor: '#ffffff', subColor: '#e6dfe4', boxColor: '#1f1b22', bgColor: '#1f1b22', ctaBg: '#ffffff', ctaColor: '#1f1b22', footerColor: '#d9d0d6' } },
];

/** What goes on a particular pin, as opposed to how every pin looks. */
export type PinContent = {
  title: string;
  subtitle: string;
  /** Pinterest's own fields, kept as live data rather than drawn into the image. */
  pinTitle: string;
  pinDescription: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export const EMPTY_CONTENT: PinContent = {
  title: '',
  subtitle: '',
  pinTitle: '',
  pinDescription: '',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};
