/**
 * Browser-side upload helper.
 *
 * Three steps per file: ask the server for a signed URL, PUT the bytes straight to storage,
 * then register the row. Only the first and last touch the server, and both are small JSON
 * requests, so a 12 MP phone photo is no harder than a thumbnail.
 */

export type UploadedFile = { id: string; path: string; name: string };

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function checkFiles(files: File[]): string | null {
  if (files.length === 0) return 'Pick at least one image.';
  for (const file of files) {
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      return `${file.name} is a ${file.type || 'unknown'} file. Use PNG, JPG or WebP.`;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 40 MB limit.`;
    }
  }
  return null;
}

export function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';
}

export async function uploadFiles(
  kind: 'design' | 'mockup',
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = [];

  for (const [index, file] of files.entries()) {
    const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';

    const signResponse = await fetch('/api/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ext }),
    });
    const signed = (await signResponse.json()) as {
      id?: string;
      path?: string;
      signedUrl?: string;
      error?: string;
    };
    if (!signResponse.ok || !signed.signedUrl || !signed.id || !signed.path) {
      throw new Error(signed.error ?? `Could not start uploading ${file.name}.`);
    }

    const put = await fetch(signed.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!put.ok) {
      throw new Error(`Uploading ${file.name} failed (${put.status}).`);
    }

    uploaded.push({ id: signed.id, path: signed.path, name: baseName(file) });
    onProgress?.(index + 1, files.length);
  }

  return uploaded;
}
