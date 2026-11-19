import { db, signedUrl } from '../supabase';

export type CustomFont = {
  id: string;
  name: string;
  /** The CSS family name the canvas draws with. */
  family: string;
  file_path: string;
  url: string | null;
};

/**
 * Fonts uploaded by the user, kept rather than re-uploaded.
 *
 * The signed URL is handed to the browser, which registers the file with the FontFace API
 * before the first draw. The canvas can only use a family the document has actually loaded,
 * so a pin made with a custom font would otherwise silently fall back to a system face.
 */
export async function listFonts(): Promise<CustomFont[]> {
  const { data, error } = await db()
    .from('fonts')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return [];

  const rows = (data ?? []) as Omit<CustomFont, 'url'>[];
  return Promise.all(
    // Long expiry: the browser re-registers these on every page load.
    rows.map(async (row) => ({ ...row, url: await signedUrl(row.file_path, 60 * 60 * 12) })),
  );
}

/** A family name that cannot collide with another upload or a system face. */
export function familyNameFor(fileName: string, id: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '') || 'Font';
  return `Custom-${base}-${id.slice(0, 8)}`;
}
