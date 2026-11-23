/**
 * A minimal ZIP writer, streamed.
 *
 * No dependency and no compression, on purpose. The only thing going in here is finished
 * renders, which are JPEGs — already compressed, so deflate would spend CPU to save
 * nothing. "Stored" entries are the simplest correct ZIP there is.
 *
 * Streamed rather than built in memory because fifteen full-resolution renders is 30-70 MB,
 * and holding that in a serverless function to hand back in one piece is the kind of thing
 * that works in testing and fails on the day there are forty of them. Each file is read,
 * written and dropped; only the central directory is kept, which is a few dozen bytes an
 * entry.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what a ZIP entry stores. */
function dosStamp(when: Date): { time: number; date: number } {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

export type ZipEntry = { name: string; bytes: Uint8Array };

export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const directory: { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number }[] = [];
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // One pass: every entry, then the central directory. `pull` is called once because
      // the whole body is produced here and the stream is closed at the end.
      for await (const entry of entries) {
        const name = encoder.encode(entry.name);
        const { time, date } = dosStamp(new Date());
        const crc = crc32(entry.bytes);

        const header = new DataView(new ArrayBuffer(30));
        header.setUint32(0, 0x04034b50, true); // local file header
        header.setUint16(4, 20, true); // version needed
        header.setUint16(6, 0, true); // flags
        header.setUint16(8, 0, true); // stored, no compression
        header.setUint16(10, time, true);
        header.setUint16(12, date, true);
        header.setUint32(14, crc, true);
        header.setUint32(18, entry.bytes.length, true);
        header.setUint32(22, entry.bytes.length, true);
        header.setUint16(26, name.length, true);
        header.setUint16(28, 0, true); // extra field length

        controller.enqueue(new Uint8Array(header.buffer));
        controller.enqueue(name);
        controller.enqueue(entry.bytes);

        directory.push({ name, crc, size: entry.bytes.length, offset, time, date });
        offset += 30 + name.length + entry.bytes.length;
      }

      const start = offset;
      for (const e of directory) {
        const record = new DataView(new ArrayBuffer(46));
        record.setUint32(0, 0x02014b50, true); // central directory header
        record.setUint16(4, 20, true); // version made by
        record.setUint16(6, 20, true); // version needed
        record.setUint16(8, 0, true);
        record.setUint16(10, 0, true);
        record.setUint16(12, e.time, true);
        record.setUint16(14, e.date, true);
        record.setUint32(16, e.crc, true);
        record.setUint32(20, e.size, true);
        record.setUint32(24, e.size, true);
        record.setUint16(28, e.name.length, true);
        record.setUint16(30, 0, true);
        record.setUint16(32, 0, true);
        record.setUint16(34, 0, true);
        record.setUint16(36, 0, true);
        record.setUint32(38, 0, true);
        record.setUint32(42, e.offset, true);
        controller.enqueue(new Uint8Array(record.buffer));
        controller.enqueue(e.name);
        offset += 46 + e.name.length;
      }

      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); // end of central directory
      end.setUint16(4, 0, true);
      end.setUint16(6, 0, true);
      end.setUint16(8, directory.length, true);
      end.setUint16(10, directory.length, true);
      end.setUint32(12, offset - start, true);
      end.setUint32(16, start, true);
      end.setUint16(20, 0, true);
      controller.enqueue(new Uint8Array(end.buffer));

      controller.close();
    },
  });
}

/** A filename that survives a zip tool, a Finder and a shell. */
export function safeName(parts: string[], extension: string): string {
  const slug = parts
    .map((p) =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48),
    )
    .filter(Boolean)
    .join('_');
  return `${slug || 'render'}.${extension}`;
}
