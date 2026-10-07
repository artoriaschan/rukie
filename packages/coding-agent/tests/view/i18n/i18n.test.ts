import { expect, test } from "bun:test";
import { appCopy } from "../../../src/view/i18n/locales";
import { createTuiI18n, formatError } from "../../../src/view/i18n/index";

const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]))].sort();

test("TUI copy preserves interpolation parameters in both locales", () => {
  for (const key of Object.keys(appCopy.zh) as (keyof typeof appCopy.zh)[]) {
    expect(placeholders(appCopy.en[key]), key).toEqual(placeholders(appCopy.zh[key]));
  }
});

test.each(["zh", "en"] as const)("TUI formats subagent hook diagnostics in %s", (locale) => {
  const t = createTuiI18n(locale);
  expect(
    formatError(
      { code: "hook-project-untrusted", params: { source: "/project/agents/custom.md" } },
      t,
    ),
  ).toBe(
    locale === "zh"
      ? "/project/agents/custom.md：忽略 hooks，只有受信任的项目可以定义 hooks"
      : "/project/agents/custom.md: ignoring hooks; only trusted projects can define hooks",
  );
  expect(
    formatError(
      {
        code: "hook-config-invalid",
        params: { source: "/project/agents/custom.md: /hooks", cause: "expected array" },
      },
      t,
    ),
  ).toBe(
    locale === "zh"
      ? "/project/agents/custom.md: /hooks：无效的 hooks 配置：expected array"
      : "/project/agents/custom.md: /hooks: invalid hooks configuration: expected array",
  );
});
