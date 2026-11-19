import type { PinCard } from './data';

/**
 * CSV of pin titles and descriptions, ported from the original tool.
 *
 * The shape is carried over deliberately: a UTF-8 BOM so Excel does not mangle accented
 * characters, CRLF line endings, and doubled quotes inside quoted fields. The point of the
 * file is to paste the text into Pinterest alongside the uploaded images, so the file name
 * column has to match what was downloaded.
 */

const quote = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;

const slug = (s: string): string =>
  (s || 'pin')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'pin';

export function pinFileName(pin: Pick<PinCard, 'title' | 'headline' | 'design_title' | 'output_path'>): string {
  const extension = pin.output_path?.endsWith('.jpg') ? 'jpg' : 'png';
  return `${slug(pin.title || pin.headline || pin.design_title)}-pin.${extension}`;
}

export function pinsToCsv(pins: PinCard[]): string {
  const header = ['File', 'Pinterest title', 'Pinterest description', 'Headline on image', 'Link']
    .map(quote)
    .join(',');

  const rows = pins.map((pin) =>
    [pinFileName(pin), pin.title, pin.description, pin.headline, pin.link].map(quote).join(','),
  );

  // The BOM is what stops Excel reading UTF-8 as its own legacy encoding.
  return `﻿${[header, ...rows].join('\r\n')}`;
}
