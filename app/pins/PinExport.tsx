'use client';

import { pinsToCsv } from '@/lib/pins/csv';
import type { PinCard } from '@/lib/pins/data';

/**
 * Download the saved pins' titles and descriptions as CSV, as the original tool did.
 *
 * The images and the text go to Pinterest separately, so the file exists to be read beside
 * the downloaded images — which is why the first column is the file name.
 */
export function PinExport({ pins }: { pins: PinCard[] }) {
  function download() {
    const blob = new Blob([pinsToCsv(pins)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pin-titles-descriptions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (pins.length === 0) return null;

  return (
    <button className="btn" onClick={download} title="File names, Pinterest titles and descriptions">
      Titles &amp; descriptions (.csv)
    </button>
  );
}
