import { expect, test } from "bun:test";
import { allocatePanelHeights } from "../../../src/components/panel-layout";

test("visible panels share the remaining rows, while a sole panel gets the whole budget", () => {
  expect(allocatePanelHeights(10, [3, 3])).toEqual([5, 5]);
  expect(allocatePanelHeights(10, [3])).toEqual([10]);
  expect(allocatePanelHeights(10, [])).toEqual([]);
});

test("each panel falls back to a one-row preview below its own expansion minimum", () => {
  expect(allocatePanelHeights(4, [3, 3])).toEqual([1, 1]);
  expect(allocatePanelHeights(6, [3, 4])).toEqual([3, 1]);
  expect(allocatePanelHeights(0, [3])).toEqual([1]);
});
