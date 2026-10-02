const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function sanitizeFragment(text: string): string {
  return (
    Bun.stripANSI(text)
      // oxlint-disable-next-line no-control-regex -- model-written controls must not reach the terminal
      .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function truncate(text: string, columns: number): string {
  if (Bun.stringWidth(text) <= columns) return text;
  let result = "";
  let width = 0;
  for (const { segment } of segmenter.segment(text)) {
    const size = Bun.stringWidth(segment);
    if (width + size > columns - 1) break;
    result += segment;
    width += size;
  }
  return `${result}…`;
}

export function detailFor(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  for (const key of [
    "path",
    "file",
    "file_path",
    "command",
    "cmd",
    "pattern",
    "query",
    "url",
    "description",
    "name",
  ]) {
    if (!(key in args)) continue;
    const value = (args as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const clean = sanitizeFragment(value);
    if (clean) return truncate(clean, 40);
  }
  return "";
}

export function extractNarration(line: string): string | undefined {
  if (!line.startsWith("⏵")) return undefined;
  const clean = sanitizeFragment(line.slice(1));
  const boundary = clean.search(/[。．!?！？;；]|\.(?=\s|$|[A-Z][a-z])/);
  const sentence = boundary < 0 ? clean : clean.slice(0, boundary + 1);
  const text = truncate(sentence, 80)
    .replace(/[。．.!！,，、;；]+$/, "")
    .trim();
  return text || undefined;
}
