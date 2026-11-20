/**
 * Reading and writing the fixed part of a listing description.
 *
 * The shop writes descriptions as HTML paragraphs: a few of prose, then headed blocks of
 * bullets. The headed blocks are product facts — fabric, care, measurements — and they are
 * byte-identical across every listing. Those are parsed out of the real listings and stored,
 * so the model is never asked to reproduce a spec it could get wrong.
 */

export type BlockLine = {
  text: string;
  /**
   * Only include this line when the condition holds.
   *
   * The one in use is `both-sides`: the shop's two-sided listings carry a "Printed on the
   * front and back" bullet and its one-sided listings do not, which is exactly the kind of
   * detail that is wrong in a hurry when a human copies a description across.
   */
  requires?: 'both-sides';
};

export type Block = {
  heading: string;
  lines: BlockLine[];
  /** True when lines were written as "- item" bullets rather than plain rows. */
  bulleted: boolean;
};

/** A description split into its written paragraphs and its headed blocks. */
export type ParsedDescription = {
  paragraphs: string[];
  blocks: Block[];
};

const BULLET = /^-\s+/;

export function parseDescription(html: string): ParsedDescription {
  const paragraphs: string[] = [];
  const blocks: Block[] = [];

  for (const chunk of splitParagraphs(html)) {
    const headed = /^<strong>(.*?)<\/strong>\s*(?:<br\s*\/?>)?([\s\S]*)$/i.exec(chunk);
    if (headed) {
      const rows = headed[2]!
        .split(/<br\s*\/?>/i)
        .map((row) => decode(stripTags(row)).trim())
        .filter(Boolean);
      blocks.push({
        heading: decode(stripTags(headed[1]!)).trim(),
        bulleted: rows.length > 0 && rows.every((row) => BULLET.test(row)),
        lines: rows.map((row) => ({ text: row.replace(BULLET, '') })),
      });
    } else {
      const text = decode(stripTags(chunk)).trim();
      if (text) paragraphs.push(text);
    }
  }

  return { paragraphs, blocks };
}

/** The inverse: the shop's own HTML shape, so a written listing matches the ones beside it. */
export function renderDescription(paragraphs: string[], blocks: Block[]): string {
  const parts = paragraphs.filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`);

  for (const block of blocks) {
    if (block.lines.length === 0) continue;
    const rows = block.lines
      .map((line) => `${block.bulleted ? '- ' : ''}${escapeHtml(line.text)}`)
      .join('<br />');
    parts.push(`<p><strong>${escapeHtml(block.heading)}</strong><br />${rows}</p>`);
  }

  return parts.join('\n');
}

/** Drop the lines whose condition does not hold for this product. */
export function blocksFor(blocks: Block[], facts: { bothSides: boolean }): Block[] {
  return blocks
    .map((block) => ({
      ...block,
      lines: block.lines.filter((line) =>
        line.requires === 'both-sides' ? facts.bothSides : true,
      ),
    }))
    .filter((block) => block.lines.length > 0);
}

function splitParagraphs(html: string): string[] {
  // Descriptions written elsewhere may have no markup at all, in which case the whole thing
  // is one paragraph rather than nothing.
  if (!/<p[\s>]/i.test(html)) return html.trim() ? [html] : [];
  return html
    .split(/<\/p>/i)
    .map((chunk) => chunk.replace(/^[\s\S]*?<p[^>]*>/i, '').trim())
    .filter(Boolean);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A stable key for comparing a block across listings. */
export function blockKey(block: Block): string {
  return `${block.heading}\u0000${block.lines.map((l) => l.text).join('\u0000')}`;
}
