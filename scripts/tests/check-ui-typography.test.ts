import { expect, test } from "bun:test";
import { checkUiTypography } from "../check-ui-typography.ts";

test.each([
  '<div className="text-sm" />',
  '<div className="hover:text-xl md:text-[13px]" />',
  'const classes = cn("text-2xl", active && "text-xs");',
  "<div style={{ fontSize: 13 }} />",
  'const style = { "font-size": "14px" };',
])("rejects interface font override %s", (source) => {
  expect(checkUiTypography("packages/ui/src/components/label.tsx", source)).not.toHaveLength(0);
});
test("permits UI tokens, colors and inert documentation", () => {
  expect(
    checkUiTypography(
      "label.tsx",
      `<div className="text-ui-base text-foreground text-center" />; // text-sm`,
    ),
  ).toEqual([]);
});

test("rejects quoted and computed fontSize properties", () => {
  expect(
    checkUiTypography("label.tsx", 'const style = { "fontSize": 14, ["fontSize"]: 14 };'),
  ).toHaveLength(2);
});
