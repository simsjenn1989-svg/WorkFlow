/**
 * Remembering the studio's settings between visits, as the original tool did.
 *
 * Only *settings* are kept — how a pin looks, and how copy is asked for. The headline, the
 * chosen render and the Pinterest fields belong to one pin and are deliberately not
 * restored: reopening the studio should not silently re-apply the last pin's words to the
 * next one.
 */

const PREFIX = 'workflow.pin.';

/**
 * Keys carry a version. If a stored shape ever stops matching the code, bumping the version
 * is cleaner than trying to migrate whatever is in a browser somewhere.
 */
export const STYLE_KEY = `${PREFIX}style.v1`;
export const COPY_KEY = `${PREFIX}copy.v1`;

/**
 * Read stored settings and merge them over the defaults.
 *
 * Merging matters: a value saved before a new setting existed would otherwise come back
 * missing that field entirely, and the UI would render an undefined slider.
 */
export function loadSettings<T extends object>(key: string, defaults: T): T {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    return { ...defaults, ...(parsed as Partial<T>) };
  } catch {
    // Private browsing, a full quota, or corrupt JSON. Defaults are a fine answer.
    return defaults;
  }
}

export function saveSettings(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage being unavailable should never break the editor.
  }
}
