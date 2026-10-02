import { expect, test } from "bun:test";
import { sweep } from "../../src";

const base = { r: 0, g: 0, b: 0 };
const highlight = { r: 255, g: 255, b: 255 };

test("sweep keeps text outside the window at base and merges adjacent equal colors", () => {
  expect(sweep("abcdefghijklmno", 0, base, highlight)).toEqual([
    { text: "abcdefghijklmno", color: "#000000" },
  ]);
  expect(sweep("", 0, base, highlight)).toEqual([]);
});

test("sweep advances one column per step, pulses brightness, and repeats after width plus twenty", () => {
  expect(sweep("abcdefghijklmno", 60, base, highlight)).toEqual([
    { text: "a", color: "#bdbdbd" },
    { text: "bcdefghijklmno", color: "#000000" },
  ]);
  expect(sweep("abcdefghijklmno", 120, base, highlight)).toEqual([
    { text: "ab", color: "#ebebeb" },
    { text: "cdefghijklmno", color: "#000000" },
  ]);
  expect(sweep("abcdefghijklmno", 660, base, highlight)).toEqual([
    { text: "a", color: "#000000" },
    { text: "bcdefghijk", color: "#262626" },
    { text: "lmno", color: "#000000" },
  ]);
  expect(sweep("abcdefghijklmno", 2100, base, highlight)).toEqual([
    { text: "abcdefghijklmno", color: "#000000" },
  ]);
  expect(sweep("abc", 120, base, highlight, 120)).toEqual([
    { text: "a", color: "#bdbdbd" },
    { text: "bc", color: "#000000" },
  ]);
});

test("sweep measures CJK in two columns and highlights only whole graphemes", () => {
  expect(sweep("你好abc", 60, base, highlight)).toEqual([{ text: "你好abc", color: "#000000" }]);
  expect(sweep("你好abc", 120, base, highlight)).toEqual([
    { text: "你", color: "#ebebeb" },
    { text: "好abc", color: "#000000" },
  ]);
  expect(sweep("你好abc", 180, base, highlight)).toEqual([
    { text: "你", color: "#ffffff" },
    { text: "好abc", color: "#000000" },
  ]);
  expect(sweep("你a", 1500, base, highlight)).toEqual([
    { text: "你", color: "#777777" },
    { text: "a", color: "#000000" },
  ]);
  expect(sweep("👩‍💻x", 120, base, highlight)).toEqual([
    { text: "👩‍💻", color: "#ebebeb" },
    { text: "x", color: "#000000" },
  ]);
  expect(sweep("e\u0301x", 60, base, highlight)).toEqual([
    { text: "e\u0301", color: "#bdbdbd" },
    { text: "x", color: "#000000" },
  ]);
});

test("sweep coalesces the entire string when highlight and base are the same", () => {
  expect(sweep("你好abcdefghijk", 660, base, base)).toEqual([
    { text: "你好abcdefghijk", color: "#000000" },
  ]);
});
