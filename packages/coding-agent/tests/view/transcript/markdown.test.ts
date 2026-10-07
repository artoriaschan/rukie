import { expect, test } from "bun:test";
import { markdownProjection, markdownText } from "../../../src/view/transcript/markdown";

test("visible formatted matches retain their original source lines", () => {
  const projection = markdownProjection("**needle**\n\n`needle`\n\n\\(x^2\\)");
  expect(projection.text).toBe("needle\nneedle\nx²");
  expect(projection.sourceLines).toHaveLength(projection.text.length);
  expect(projection.sourceLines[projection.text.indexOf("needle")]).toBe(0);
  expect(projection.sourceLines[projection.text.lastIndexOf("needle")]).toBe(2);
  expect(projection.sourceLines.at(-1)).toBe(4);
});

test("TeX normalization protects code and HTML while preserving unsupported literals", () => {
  expect(
    markdownText(
      "`\\(x^2\\)`\n\n```text\n\\[x^2\\]\n```\n\n<div>\\(x^2\\)</div>\n\n\\(\\unknown{x}\\)",
    ),
  ).toBe("\\(x^2\\)\n\\[x^2\\]\n<div>\\(x^2\\)</div>\n\\(\\unknown{x}\\)");
});

test("math retains prices, unclosed display text and formulas exceeding display limits", () => {
  for (const source of ["$20 and $30", "$$\nx^2", "$" + "x".repeat(4097) + "$"]) {
    expect(markdownText(source)).toBe(source);
  }
  expect(markdownText("$x^2$", 5)).toBe("$x^2$");
  expect(markdownText("$x^2$", 6)).toBe("x²");
});

test("Mermaid projection chooses fitted art or original code and retains source mapping", () => {
  const source = "```mermaid\ngraph LR\nA[Start] --> B[End]\n```";
  const wide = markdownProjection(source, 80);
  expect(wide.text).toContain("Start");
  expect(wide.text).not.toContain("graph LR");
  expect(wide.sourceLines).toHaveLength(wide.text.length);
  expect(wide.sourceLines[0]).toBe(1);
  expect(markdownText(source, 8)).toBe("graph LR\nA[Start] --> B[End]");
  const tooLong = "graph LR\n" + " ".repeat(20000);
  expect(markdownText("```mermaid\n" + tooLong + "\n```", 80)).toBe(tooLong);
  expect(markdownText("```mermaid\ninvalid source\n```", 80)).toBe("invalid source");
});
