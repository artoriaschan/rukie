/** Owned output retention; Jobs owns full-output spill files. */
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINES = 2000;
export function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;
}
type Truncation = {
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  firstLineExceedsLimit: boolean;
  lastLinePartial: boolean;
  maxBytes: number;
  maxLines: number;
};
export function truncateHead(text: string) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines.slice(0, DEFAULT_MAX_LINES)) {
    const added = Buffer.byteLength(line) + (kept.length ? 1 : 0);
    if (bytes + added > DEFAULT_MAX_BYTES) break;
    bytes += added;
    kept.push(line);
  }
  const truncated = kept.length < lines.length;
  return {
    content: kept.join("\n"),
    truncated,
    truncatedBy: truncated ? (kept.length === DEFAULT_MAX_LINES ? "lines" : "bytes") : null,
  };
}
export class OutputCapture {
  private decoder = new TextDecoder();
  private text = "";
  private totalBytes = 0;
  private newlines = 0;
  private endsWithNewline = false;
  private spillPath: string | undefined;
  private droppedBy: "lines" | "bytes" | null = null;
  private partial = false;
  constructor(
    private options: {
      limits: { maxBytes: number; maxLines: number; retain: "tail" };
      spill: boolean;
    },
  ) {}
  get truncated() {
    return this.droppedBy !== null;
  }
  push(chunk: Uint8Array) {
    this.totalBytes += chunk.byteLength;
    this.accept(this.decoder.decode(chunk, { stream: true }));
  }
  private accept(value: string) {
    if (!value) return;
    this.newlines += value.split("\n").length - 1;
    this.endsWithNewline = value.endsWith("\n");
    this.text += value;
    const { maxBytes, maxLines } = this.options.limits;
    const lines = this.text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (lines.length > maxLines) {
      this.text = lines.slice(-maxLines).join("\n") + (this.endsWithNewline ? "\n" : "");
      this.droppedBy = "lines";
    }
    const bytes = Buffer.from(this.text);
    if (bytes.length > maxBytes) {
      let start = bytes.length - maxBytes;
      while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
      let tail = bytes.subarray(start).toString("utf8");
      const newline = tail.indexOf("\n");
      this.partial = newline < 0;
      if (newline >= 0 && newline < tail.length - 1) tail = tail.slice(newline + 1);
      this.text = tail;
      this.droppedBy = "bytes";
    }
  }
  finish() {
    this.accept(this.decoder.decode());
  }
  setSpillPath(path: string) {
    this.spillPath = path;
  }
  snapshot() {
    const truncation: Truncation = {
      truncated: this.truncated,
      truncatedBy: this.droppedBy,
      totalLines: this.newlines + (this.totalBytes && !this.endsWithNewline ? 1 : 0),
      totalBytes: this.totalBytes,
      outputLines: this.text
        ? this.text.split("\n").length - (this.text.endsWith("\n") ? 1 : 0)
        : 0,
      outputBytes: Buffer.byteLength(this.text),
      firstLineExceedsLimit: false,
      lastLinePartial: this.partial,
      ...this.options.limits,
    };
    return {
      text: this.text,
      truncation,
      spillPath: this.spillPath,
      lastLineBytes: Buffer.byteLength(this.text.split("\n").at(-1) ?? ""),
    };
  }
}
