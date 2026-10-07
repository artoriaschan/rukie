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

test("pixel inspection crops original pixels with alpha and independent snapshots", async () => {
  const sharp = (await import("sharp")).default;
  const original = await sharp(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255]),
    { raw: { width: 2, height: 2, channels: 4 } },
  )
    .png()
    .toBuffer();
  const first = await decodeTerminalImage(original, "preview", { x: 1, y: 0, width: 1, height: 1 });
  const next = await decodeTerminalImage(original, "preview", { x: 0, y: 1, width: 1, height: 1 });
  expect([...first.data]).toEqual([0, 255, 0, 128]);
  expect([...next.data]).toEqual([0, 0, 255, 0]);
  expect([...first.data]).toEqual([0, 255, 0, 128]);
  expect(next.data).not.toBe(first.data);
});

test("malformed pixels fail before creating a renderer source", async () => {
  await expect(decodeTerminalImage(new Uint8Array([1, 2, 3]), "transcript")).rejects.toThrow();
});
