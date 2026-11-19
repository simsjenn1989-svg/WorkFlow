/**
 * Recover a truncated JSON reply, ported from `legacy/pin-tool/index.html`.
 *
 * A model that stops mid-object leaves valid JSON up to the last completed value. This walks
 * the text tracking string state and nesting, then closes the structure at the last safe
 * point. Small and unglamorous, and the difference between a usable tool and a frustrating
 * one when a reply gets cut off.
 */
export function salvageJSON(text: string): unknown {
  type Frame = { t: '{' | '['; key?: boolean };
  const stack: Frame[] = [];
  let inStr = false;
  let esc = false;
  let isKey = false;
  let safe: { i: number; closers: string } | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') {
        inStr = false;
        const top = stack[stack.length - 1];
        if (isKey) {
          if (top) top.key = false;
        } else {
          safe = { i, closers: stack.map((x) => (x.t === '{' ? '}' : ']')).reverse().join('') };
        }
      }
      continue;
    }

    const top = stack[stack.length - 1];
    if (ch === '"') {
      inStr = true;
      isKey = Boolean(top && top.t === '{' && top.key);
    } else if (ch === '{') {
      stack.push({ t: '{', key: true });
    } else if (ch === '[') {
      stack.push({ t: '[' });
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      safe = { i, closers: stack.map((x) => (x.t === '{' ? '}' : ']')).reverse().join('') };
      if (stack.length === 0) break;
    } else if (ch === ',' && top && top.t === '{') {
      top.key = true;
    }
  }

  if (!safe) return null;
  try {
    return JSON.parse(text.slice(0, safe.i + 1) + safe.closers);
  } catch {
    return null;
  }
}

/** Parse a model reply that may be fenced, prefixed, or cut off. */
export function parseReply(raw: string): unknown {
  const text = raw.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    // Models sometimes prefix a sentence before the object.
    const start = text.indexOf('{');
    if (start > 0) {
      try {
        return JSON.parse(text.slice(start));
      } catch {
        /* fall through to salvage */
      }
    }
    return salvageJSON(start >= 0 ? text.slice(start) : text);
  }
}
