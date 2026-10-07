import { expect, test } from "bun:test";
import { alignSplitDiff } from "../../src";

test("split alignment preserves every source identity in large unequal replacements", () => {
  type SourceLine = Parameters<typeof alignSplitDiff>[0][number];
  const lines: SourceLine[] = [
    { text: "file.txt", tone: "path" },
    ...Array.from({ length: 1200 }, (_, i): SourceLine => ({ text: `-old-${i}`, tone: "del" })),
    ...Array.from({ length: 1400 }, (_, i): SourceLine => ({ text: `+OLD-${i}`, tone: "add" })),
  ];
  const rows = alignSplitDiff(lines);
  expect(rows).toHaveLength(1401);
  expect(rows[1]?.sourceLines).toEqual([1, 1201]);
  expect(rows[1201]?.sourceLines).toEqual([2401]);
  expect(rows.flatMap((row) => row.sourceLines ?? []).sort((a, b) => a - b)).toEqual(
    lines.map((_, index) => index),
  );
});
