import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { decodeTerminalImage } from "../../../src/tui/components/image-source";

// Application image boundary: originals remain encoded, renderer snapshots are bounded RGBA.
test("an admitted 8000 square original has bounded transcript and preview snapshots", async () => {
  const original = await readFile(new URL("../../ink/fixtures/8000x8000.png", import.meta.url));
  const transcript = await decodeTerminalImage(original, "transcript");
  expect(transcript.width).toBe(1024);
  expect(transcript.height).toBe(1024);
  expect(transcript.data.byteLength).toBe(4 * 1024 * 1024);
  const preview = await decodeTerminalImage(original, "preview");
  expect(preview.width).toBeLessThanOrEqual(2048);
  expect(preview.data.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(original.subarray(1, 4).toString()).toBe("PNG");
});
