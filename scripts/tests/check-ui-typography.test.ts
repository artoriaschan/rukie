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

test.each([
  ".label { font-size: 14px; }",
  ".label { FONT-SIZE: 1rem !important; }",
  ".label { font-size: clamp(12px, 2vw, 18px); }",
  ".label { font-size: calc(var(--ui-font-size) * 1px); }",
  ".label { font-size: var(--ui-font-size); }",
  ".label { font-size: var(--text-ui-base, 14px); }",
])("rejects CSS interface font override %s", (source) => {
  expect(checkUiTypography("label.css", source)).toHaveLength(1);
});

test("permits CSS role references and ignores comments, strings and custom token declarations", () => {
  expect(
    checkUiTypography(
      "label.css",
      `/* font-size: 99px; */
:root { --text-ui-base: 14px; --sample: "font-size: 99px;"; }
.label { content: "escaped \\" font-size: 88px;"; font-size: var(--text-ui-base); }
@media (width < 420px) { .code { font-size: var(--text-code) !important; } }
`,
    ),
  ).toEqual([]);
});

test("reports original CSS declaration lines through multiline comments", () => {
  expect(
    checkUiTypography("label.css", "/* first\nsecond */\n.label {\n font-size: 12px;\n}"),
  ).toEqual(["label.css:4: use text-ui-* or text-code for interface font sizes"]);
});
