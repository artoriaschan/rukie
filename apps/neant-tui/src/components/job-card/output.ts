export function cleanJobText(text: string) {
  return (
    Bun.stripANSI(text)
      .replace(/\r\n?/g, "\n")
      // oxlint-disable-next-line no-control-regex -- job output cannot inject terminal controls
      .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ")
  );
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function jobOutputRows(text: string, columns: number, limit = 2) {
  const rows: string[] = [];
  // Match the renderer: Bun supplies word boundaries, then hard-wrap whole
  // graphemes so long log lines cannot clip their final two visual rows.
  for (const line of Bun.wrapAnsi(cleanJobText(text).replace(/\n$/, ""), columns).split("\n")) {
    let row = "";
    let width = 0;
    for (const { segment } of graphemes.segment(line)) {
      const size = Bun.stringWidth(segment);
      if (size <= 0 || size > columns) continue;
      if (width + size > columns) {
        rows.push(row);
        row = "";
        width = 0;
      }
      row += segment;
      width += size;
    }
    rows.push(row);
  }
  return rows.slice(-limit);
}
