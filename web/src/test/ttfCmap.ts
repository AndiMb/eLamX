// The characters a TrueType font has glyphs for, read from its `cmap` table.
// Only for the tests: the report's font must hold every character the report
// can write, because jsPDF drops a missing one without a word.

/** Code points mapped to a glyph other than .notdef. */
export function cmapCodePoints(font: Uint8Array): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = view.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + 16 * i;
    const tag = String.fromCharCode(...font.subarray(record, record + 4));
    if (tag === "cmap") cmap = view.getUint32(record + 8);
  }
  if (cmap < 0) throw new Error("no cmap table");
  const points = new Set<number>();
  const subtables = view.getUint16(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const platform = view.getUint16(cmap + 4 + 8 * i);
    const offset = cmap + view.getUint32(cmap + 4 + 8 * i + 4);
    if (platform !== 0 && platform !== 3) continue;
    const format = view.getUint16(offset);
    if (format === 4) {
      const segments = view.getUint16(offset + 6) / 2;
      const ends = offset + 14;
      const starts = ends + 2 * segments + 2;
      const deltas = starts + 2 * segments;
      const ranges = deltas + 2 * segments;
      for (let s = 0; s < segments; s++) {
        const end = view.getUint16(ends + 2 * s);
        const start = view.getUint16(starts + 2 * s);
        const delta = view.getInt16(deltas + 2 * s);
        const rangeOffset = view.getUint16(ranges + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xffff;
          } else {
            const at = ranges + 2 * s + rangeOffset + 2 * (c - start);
            glyph = view.getUint16(at);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) points.add(c);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(offset + 12);
      for (let g = 0; g < groups; g++) {
        const at = offset + 16 + 12 * g;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        const glyph = view.getUint32(at + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) points.add(c);
      }
    }
  }
  return points;
}
