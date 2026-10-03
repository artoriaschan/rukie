import { expect, test } from "bun:test";
import { appCopy } from "../../src/i18n/locales";

const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]))].sort();

test("TUI copy preserves interpolation parameters in both locales", () => {
  for (const key of Object.keys(appCopy.zh) as (keyof typeof appCopy.zh)[]) {
    expect(placeholders(appCopy.en[key]), key).toEqual(placeholders(appCopy.zh[key]));
  }
});
